import fs from 'node:fs';
import path from 'node:path';
import type { Agent, Message, Task, TestSummary } from '../../shared/types.js';
import { estimateCost } from '../../shared/pricing.js';
import type { Core } from '../core.js';
import type { AgentService } from './agentService.js';
import type { TaskService } from '../tasks/taskService.js';
import type { MessageService } from '../messages/messageService.js';
import type { ApprovalService } from '../approvals/approvalService.js';
import type { RoleService } from '../roles/roleService.js';
import type { ProjectService } from '../projects/projectService.js';
import { agentHome, type RunResult } from '../process/processManager.js';
import { requirePermission, resolveInside } from '../security/sandbox.js';
import { looksLikeTestCommand, parseTestOutput } from '../tasks/testParser.js';
import { BudgetExceededError, StopError, type AgentControl, type AgentRuntime, type MessageTarget, type RunOutcome, type RuntimeContext } from './runtime.js';

const MAX_FILE_BYTES = 2 * 1024 * 1024;

export interface RunnerHooks {
  onTaskSucceeded(task: Task, agent: Agent, summary: string): Promise<void>;
  onTaskFailed(task: Task, agent: Agent, error: string): Promise<void>;
  onTaskInterrupted(task: Task, agent: Agent): void;
  spawnSubAgent(parent: Agent, input: { roleId: string; name?: string }): Promise<Agent>;
}

class Control implements AgentControl {
  private abort = new AbortController();
  paused = false;
  private resumeWaiters: (() => void)[] = [];

  get signal() {
    return this.abort.signal;
  }

  async checkpoint() {
    if (this.abort.signal.aborted) throw new StopError();
    while (this.paused) {
      await new Promise<void>((r) => this.resumeWaiters.push(r));
      if (this.abort.signal.aborted) throw new StopError();
    }
  }

  pause() {
    this.paused = true;
  }

  resume() {
    this.paused = false;
    for (const r of this.resumeWaiters.splice(0)) r();
  }

  stop() {
    this.abort.abort();
    this.resume();
  }
}

/** Executes one task for one agent inside its worktree, with full lifecycle bookkeeping. */
export class AgentRunner {
  private controls = new Map<string, Control>();
  private running = new Map<string, Promise<void>>();

  constructor(
    private core: Core,
    private agents: AgentService,
    private tasks: TaskService,
    private messages: MessageService,
    private approvals: ApprovalService,
    private roles: RoleService,
    private projects: ProjectService,
    private runtimes: Record<Agent['runtime'], AgentRuntime>,
    private hooks: RunnerHooks,
  ) {}

  runtimeFor(agent: Agent): AgentRuntime {
    return this.runtimes[agent.runtime];
  }

  isRunning(agentId: string) {
    return this.running.has(agentId);
  }

  activeCount(projectId?: string) {
    if (!projectId) return this.running.size;
    return [...this.running.keys()].filter((id) => this.agents.find(id)?.projectId === projectId).length;
  }

  pause(agentId: string): boolean {
    const c = this.controls.get(agentId);
    if (!c) return false;
    c.pause();
    return true;
  }

  resume(agentId: string): boolean {
    const c = this.controls.get(agentId);
    if (!c) return false;
    c.resume();
    return true;
  }

  stop(agentId: string): boolean {
    const c = this.controls.get(agentId);
    this.core.pm.killAgent(agentId);
    if (!c) return false;
    c.stop();
    return true;
  }

  async waitIdle(agentId: string) {
    await this.running.get(agentId);
  }

  /** Stop every running agent and wait for their runs to unwind (shutdown). */
  async stopAll(timeoutMs = 5000): Promise<void> {
    for (const id of this.running.keys()) this.stop(id);
    await Promise.race([Promise.allSettled([...this.running.values()]), new Promise((r) => setTimeout(r, timeoutMs))]);
  }

  /** Start a task (non-blocking). */
  start(agent: Agent, task: Task): Promise<void> {
    if (this.running.has(agent.id)) throw new Error(`${agent.name} is already running a task`);
    const p = this.execute(agent, task).finally(() => {
      this.running.delete(agent.id);
      this.controls.delete(agent.id);
    });
    this.running.set(agent.id, p);
    return p;
  }

  private async execute(agentIn: Agent, taskIn: Task): Promise<void> {
    const control = new Control();
    this.controls.set(agentIn.id, control);
    const project = this.projects.get(agentIn.projectId);
    const role = this.roles.get(agentIn.roleId);
    const startedAt = Date.now();
    let agent = this.agents.update(agentIn.id, { status: 'working', statusReason: null, currentTaskId: taskIn.id, startedAt: agentIn.startedAt ?? startedAt });
    let task = this.tasks.setStatus(taskIn.id, 'working', { assignedAgentId: agent.id, branch: agent.branch, attempts: taskIn.attempts + 1, error: null });
    const sys = (line: string) => this.core.logs.line(project.id, agent.id, task.id, 'system', line);
    this.messages.send(project.id, {
      kind: 'task',
      toAgentId: agent.id,
      taskId: task.id,
      body: `${agent.name} started “${task.title}”${task.attempts > 1 ? ` (attempt ${task.attempts}/${task.maxAttempts})` : ''}`,
      meta: { event: 'task.start' },
    });
    sys(`▶ Task ${task.id}: ${task.title} (attempt ${task.attempts}/${task.maxAttempts}) on ${agent.branch ?? 'main (read-only)'}`);

    try {
      const workspace = agent.workspacePath ?? project.repoPath;
      if (agent.branch && agent.workspacePath) {
        await this.core.git.ensureWorktree(project.repoPath, agent.branch, agent.workspacePath);
        if (task.kind === 'conflict') {
          const conflicts = await this.core.git.mergeBaseKeepConflicts(workspace, agent.name);
          sys(conflicts.length ? `⚠ Merged main with conflicts in: ${conflicts.join(', ')}` : '✓ main merged cleanly');
        } else {
          const sync = await this.core.git.syncWithBase(workspace, agent.name);
          if (!sync.ok) throw new Error(`Cannot sync with main: conflicts in ${sync.conflicts.join(', ')}`);
          if (sync.updated) {
            sys('⇣ Pulled latest main into worktree');
            this.messages.send(project.id, { kind: 'task', fromAgentId: agent.id, taskId: task.id, body: 'Pulling changes from main.', meta: { fromName: agent.name, event: 'sync' } });
          }
        }
      }

      const runtime = this.runtimeFor(agent);
      const avail = runtime.available();
      if (!avail.ok) throw new Error(`Runtime "${runtime.kind}" unavailable: ${avail.reason}`);

      const ctx = this.buildContext(project.id, agent.id, task, workspace, control);
      const outcome: RunOutcome = await runtime.run(ctx);
      agent = this.agents.get(agent.id);

      if (agent.branch && agent.workspacePath) {
        const leftover = await this.core.git.commitAll(workspace, `wip(${agent.name}): ${task.title}`, agent.name);
        if (leftover) this.recordCommit(agent, leftover);
      }
      if (!outcome.success) throw new Error(outcome.error || 'Task failed');

      // Verification: run the project's tests in the agent's worktree.
      task = this.tasks.setStatus(task.id, 'testing');
      const tests = await this.runProjectTests(this.agents.get(agent.id), task, control);
      if (tests) {
        task = this.tasks.update(task.id, { tests });
        if (!tests.ok) throw new Error(`Tests failed (${tests.failed} failed, ${tests.passed} passed): ${tests.command}`);
      }

      if (agent.branch) {
        const files = await this.core.git.committedChanges(project.repoPath, agent.branch);
        task = this.tasks.update(task.id, { files: files.map((f) => f.path), result: outcome.summary });
        this.agents.update(agent.id, { filesChanged: files.length });
      } else {
        task = this.tasks.update(task.id, { result: outcome.summary });
      }
      sys(`✓ ${outcome.summary}`);
      await this.hooks.onTaskSucceeded(this.tasks.get(task.id), this.agents.get(agent.id), outcome.summary);
    } catch (e) {
      const a = this.agents.find(agent.id);
      if (!a) return; // agent deleted mid-run
      if (e instanceof StopError || control.signal.aborted) {
        sys('■ Stopped by user');
        this.hooks.onTaskInterrupted(this.tasks.get(task.id), a);
        return;
      }
      const message = (e as Error).message;
      sys(`✗ ${message}`);
      await this.hooks.onTaskFailed(this.tasks.get(task.id), a, message);
    } finally {
      const a = this.agents.find(agent.id);
      if (a) this.agents.update(a.id, { currentTaskId: null, cpu: 0, memMb: 0 });
    }
  }

  /** Run the configured test command in the agent's worktree. Null when not applicable. */
  async runProjectTests(agent: Agent, task: Task | null, control?: AgentControl): Promise<TestSummary | null> {
    const project = this.projects.get(agent.projectId);
    const cmd = project.settings.testCommand.trim();
    const dir = agent.workspacePath;
    if (!cmd || !dir || !fs.existsSync(dir)) return null;
    if (/^(npm|pnpm|yarn)\b/.test(cmd) && !fs.existsSync(path.join(dir, 'package.json'))) return null;
    const r = await this.core.pm.run({
      projectId: project.id,
      agentId: agent.id,
      taskId: task?.id ?? null,
      command: cmd,
      cwd: dir,
      permissions: ['fs.read', 'fs.write', 'exec'],
      timeoutSec: 600,
      maxMemoryMb: 4096,
      home: agentHome(this.core.config.dataDir, agent.id),
      mounts: [project.repoPath],
      signal: control?.signal,
    });
    if (control?.signal.aborted) throw new StopError();
    const counts = parseTestOutput(`${r.stdout}\n${r.stderr}`) ?? { passed: r.ok ? 1 : 0, failed: r.ok ? 0 : 1 };
    const head = agent.branch ? await this.core.git.head(project.repoPath, agent.branch) : null;
    const summary: TestSummary = { ...counts, ok: r.ok, command: cmd, at: Date.now(), head };
    this.agents.update(agent.id, { testsPassed: counts.passed, testsFailed: counts.failed });
    return summary;
  }

  private recordCommit(agent: Agent, commit: { hash: string; shortHash: string; author: string; message: string; date: number }) {
    const a = this.agents.get(agent.id);
    this.agents.update(a.id, { commits: a.commits + 1 });
    this.core.bus.emit({ type: 'git.commit', projectId: a.projectId, agentId: a.id, branch: a.branch ?? 'main', commit: { ...commit, branch: a.branch ?? 'main' } });
  }

  private resolveAgent(projectId: string, ref: string): Agent | undefined {
    const all = this.agents.list(projectId);
    const r = ref.trim().toLowerCase();
    return all.find((a) => a.id === ref) ?? all.find((a) => a.name.toLowerCase() === r) ?? all.find((a) => a.name.toLowerCase().includes(r));
  }

  private buildContext(projectId: string, agentId: string, task: Task, workspace: string, control: Control): RuntimeContext {
    const project = this.projects.get(projectId);
    const agent = this.agents.get(agentId);
    const role = this.roles.get(agent.roleId);
    const home = agentHome(this.core.config.dataDir, agent.id);
    let lastInbox = Date.now();
    const vars: Record<string, string> = { branch: agent.branch ?? 'main', agent: agent.name, commit: '' };
    const log = (line: string) => this.core.logs.line(projectId, agent.id, task.id, 'agent', line);

    const confirm = async (reason: string) => {
      this.agents.setStatus(agent.id, 'waiting', `Awaiting approval: ${reason}`);
      const ok = await this.approvals.request(projectId, agent.id, 'command', reason, { taskId: task.id }, { signal: control.signal });
      this.agents.setStatus(agent.id, 'working');
      return ok;
    };

    const run = async (command: string, opts: { timeoutSec?: number } = {}): Promise<RunResult> => {
      await control.checkpoint();
      const r = await this.core.pm.run({
        projectId,
        agentId: agent.id,
        taskId: task.id,
        command,
        cwd: workspace,
        permissions: role.permissions,
        timeoutSec: Math.min(opts.timeoutSec ?? role.limits.commandTimeoutSec, role.limits.commandTimeoutSec),
        maxMemoryMb: role.limits.maxMemoryMb,
        home,
        mounts: [project.repoPath],
        confirm,
        signal: control.signal,
      });
      if (control.signal.aborted) throw new StopError();
      if (looksLikeTestCommand(command)) {
        const counts = parseTestOutput(`${r.stdout}\n${r.stderr}`);
        if (counts) this.agents.update(agent.id, { testsPassed: counts.passed, testsFailed: counts.failed });
      }
      return r;
    };

    const briefing = this.briefing(project.id, task, agent);

    return {
      project,
      agent,
      role,
      task,
      workspace,
      control,
      vars,
      briefing,
      log,
      run,
      readFile: (rel) => {
        requirePermission(role, 'fs.read');
        const abs = resolveInside(workspace, rel);
        const st = fs.statSync(abs);
        if (st.size > MAX_FILE_BYTES) throw new Error(`File too large (${st.size} bytes)`);
        return fs.readFileSync(abs, 'utf8');
      },
      writeFile: (rel, content) => {
        requirePermission(role, 'fs.write');
        if (!agent.workspacePath) throw new Error('This agent has no worktree; it cannot write files.');
        if (Buffer.byteLength(content) > MAX_FILE_BYTES) throw new Error('Content too large');
        const abs = resolveInside(workspace, rel);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, content);
      },
      appendFile: (rel, content) => {
        requirePermission(role, 'fs.write');
        if (!agent.workspacePath) throw new Error('This agent has no worktree; it cannot write files.');
        const abs = resolveInside(workspace, rel);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.appendFileSync(abs, content);
      },
      listFiles: async (rel) => {
        requirePermission(role, 'fs.read');
        const files = await this.core.git.listFiles(workspace);
        if (!rel || rel === '.' || rel === './') return files;
        const prefix = path.relative(workspace, resolveInside(workspace, rel));
        return files.filter((f) => f === prefix || f.startsWith(`${prefix}/`));
      },
      gitStatus: async () => {
        const changes = await this.core.git.workingChanges(workspace);
        const commits = agent.branch ? await this.core.git.branchCommits(project.repoPath, agent.branch) : [];
        return [
          `Branch: ${agent.branch ?? 'main'}`,
          `Uncommitted (${changes.length}):`,
          ...changes.map((c) => `  ${c.status.padEnd(9)} ${c.path} (+${c.additions} -${c.deletions})`),
          `Commits ahead of main (${commits.length}):`,
          ...commits.map((c) => `  ${c.shortHash} ${c.message}`),
        ].join('\n');
      },
      commit: async (message) => {
        requirePermission(role, 'git.commit');
        if (!agent.branch) throw new Error('This agent has no branch.');
        const c = await this.core.git.commitAll(workspace, message.slice(0, 200), agent.name);
        if (c) {
          vars.commit = c.shortHash;
          this.recordCommit(agent, c);
          const changes = await this.core.git.committedChanges(project.repoPath, agent.branch);
          this.agents.update(agent.id, { filesChanged: changes.length });
        }
        return c;
      },
      sendMessage: (target: MessageTarget): Message => {
        const meta = { fromName: agent.name };
        let msg: Message;
        if (target.broadcast) {
          requirePermission(role, 'messages.broadcast');
          msg = this.messages.send(projectId, { kind: 'broadcast', fromAgentId: agent.id, taskId: task.id, body: target.body, meta });
        } else if (target.to || target.toRole) {
          const to = target.to
            ? this.resolveAgent(projectId, target.to)
            : this.agents.list(projectId).find((a) => a.roleId === target.toRole && a.status !== 'stopped' && a.id !== agent.id);
          if (!to) throw new Error(`No agent matches "${target.to ?? target.toRole}"`);
          msg = this.messages.send(projectId, { kind: 'direct', fromAgentId: agent.id, toAgentId: to.id, taskId: task.id, body: target.body, meta: { ...meta, toName: to.name } });
        } else {
          msg = this.messages.send(projectId, { kind: 'team', fromAgentId: agent.id, teamId: agent.teamId, taskId: task.id, body: target.body, meta });
        }
        this.agents.setStatus(agent.id, 'communicating');
        setTimeout(() => {
          try {
            const a = this.agents.find(agent.id);
            if (a?.status === 'communicating') this.agents.setStatus(agent.id, 'working');
          } catch {
            /* shutting down */
          }
        }, 1200).unref();
        return msg;
      },
      spawnAgent: async (input) => {
        requirePermission(role, 'agents.spawn');
        const roleDef = this.roles.match(input.roleId);
        const child = await this.hooks.spawnSubAgent(this.agents.get(agent.id), { roleId: roleDef.id, name: input.name });
        let childTask: Task | null = null;
        if (input.taskTitle) {
          childTask = this.tasks.create(
            projectId,
            { title: input.taskTitle, description: input.taskDescription ?? '', assignedAgentId: child.id, roleHint: roleDef.id, priority: task.priority },
            { maxAttempts: project.settings.maxTaskAttempts },
          );
        }
        return { agent: child, task: childTask };
      },
      createTask: (input) => {
        requirePermission(role, 'tasks.create');
        const assignee = input.assignTo ? this.resolveAgent(projectId, input.assignTo) : undefined;
        if (input.assignTo && !assignee) throw new Error(`No agent matches "${input.assignTo}"`);
        return this.tasks.create(
          projectId,
          { title: input.title, description: input.description, roleHint: input.roleHint ?? null, assignedAgentId: assignee?.id ?? null, dependsOn: input.dependsOn, priority: task.priority },
          { maxAttempts: project.settings.maxTaskAttempts },
        );
      },
      inbox: () => {
        const a = this.agents.get(agent.id);
        const msgs = this.messages.inbox(projectId, a.id, a.teamId, lastInbox);
        if (msgs.length) lastInbox = msgs[msgs.length - 1].createdAt;
        return msgs;
      },
      recordUsage: (model, inputTokens, outputTokens) => {
        const a = this.agents.get(agent.id);
        const tokensIn = a.tokensIn + inputTokens;
        const tokensOut = a.tokensOut + outputTokens;
        this.agents.update(a.id, { tokensIn, tokensOut, costUsd: a.costUsd + estimateCost(model, inputTokens, outputTokens) });
        if (a.tokenBudget > 0 && tokensIn + tokensOut > a.tokenBudget)
          throw new BudgetExceededError(`Token budget exhausted (${(tokensIn + tokensOut).toLocaleString()} / ${a.tokenBudget.toLocaleString()}).`);
      },
    };
  }

  /** Dependency results, failure context and teammates — so an agent starts informed. */
  private briefing(projectId: string, task: Task, agent: Agent): string {
    const parts: string[] = [];
    const deps = task.dependsOn.map((d) => this.tasks.get(d));
    if (deps.length) parts.push('Completed dependencies (already merged into main):\n' + deps.map((d) => `- ${d.title}: ${d.result ?? ''}`).join('\n'));
    if (task.fixesTaskId) {
      const broken = this.tasks.get(task.fixesTaskId);
      const failedAgent = this.agents.find(broken.assignedAgentId);
      const logs = failedAgent ? this.core.repos.logs.forAgent(failedAgent.id, 60).map((l) => `${l.stream}: ${l.line}`).join('\n') : '';
      parts.push(`You are repairing task "${broken.title}". Its error:\n${broken.error ?? 'unknown'}\n\nRecent logs of the failed agent:\n${logs}`);
    }
    if (task.attempts > 1 && task.error) parts.push(`Previous attempt failed with: ${task.error}`);
    const mates = this.agents.list(projectId).filter((a) => a.id !== agent.id && a.status !== 'stopped');
    if (mates.length) parts.push('Teammates you can message:\n' + mates.slice(0, 60).map((a) => `- ${a.name} (${a.roleId})`).join('\n'));
    return parts.join('\n\n');
  }
}
