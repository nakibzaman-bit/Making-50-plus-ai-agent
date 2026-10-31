import os from 'node:os';
import type { Agent, MergeRequest, MergeStep, ProjectMetrics, ResourceSnapshot, RuntimeKind, Task } from '../../shared/types.js';
import { TERMINAL_TASK_STATUSES } from '../../shared/types.js';
import type { Core } from '../core.js';
import type { AgentService, SpawnInput } from '../agents/agentService.js';
import type { AgentRunner, RunnerHooks } from '../agents/agentRunner.js';
import type { TaskService } from '../tasks/taskService.js';
import type { MessageService } from '../messages/messageService.js';
import type { RoleService } from '../roles/roleService.js';
import type { ProjectService } from '../projects/projectService.js';
import type { TeamService } from '../teams/teamService.js';
import type { MergeHooks, MergeQueue } from '../merge/mergeQueue.js';
import type { Plan, Planner } from './planner.js';
import { hostCpuPercent } from '../process/procStats.js';
import { HttpError } from '../util.js';

type Level = 'info' | 'success' | 'warn' | 'error';

/**
 * The brain. Turns objectives into plans, staffs teams, dispatches ready tasks under
 * resource limits, routes finished work through the merge queue, and recovers from
 * failures (retry → debugger agent → conflict-resolution tasks).
 */
export class Orchestrator implements RunnerHooks, MergeHooks {
  private timer: NodeJS.Timeout | null = null;
  private spawning = new Set<string>();
  private lastTick = Date.now();
  private ticking = false;
  runner!: AgentRunner;

  constructor(
    private core: Core,
    private projects: ProjectService,
    private agents: AgentService,
    private tasks: TaskService,
    private messages: MessageService,
    private roles: RoleService,
    private teams: TeamService,
    private merges: MergeQueue,
    private planners: { llm: Planner | null; heuristic: Planner },
  ) {}

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), this.core.config.tickMs);
    this.timer.unref?.();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  log(projectId: string, line: string, level: Level = 'info') {
    this.core.bus.emit({ type: 'orchestrator.log', projectId, line, level });
    const orch = this.orchestratorAgent(projectId);
    this.core.logs.line(projectId, orch?.id ?? null, null, 'agent', line);
  }

  orchestratorAgent(projectId: string): Agent | undefined {
    return this.agents.list(projectId).find((a) => a.roleId === 'orchestrator');
  }

  async ensureOrchestrator(projectId: string): Promise<Agent> {
    const existing = this.orchestratorAgent(projectId);
    if (existing) return existing;
    const p = this.projects.get(projectId);
    return this.agents.spawn(projectId, { roleId: 'orchestrator', name: 'Orchestrator', worktree: false, runtime: p.settings.defaultRuntime, quiet: true });
  }

  /** User-initiated spawn (API / command palette). */
  async spawn(projectId: string, input: SpawnInput): Promise<Agent> {
    const orch = await this.ensureOrchestrator(projectId);
    return this.agents.spawn(projectId, { parentId: input.parentId ?? orch.id, ...input });
  }

  async spawnSubAgent(parent: Agent, input: { roleId: string; name?: string }): Promise<Agent> {
    return this.agents.spawn(parent.projectId, { roleId: input.roleId, name: input.name, parentId: parent.id, teamId: parent.teamId, runtime: parent.runtime === 'scripted' ? 'scripted' : 'claude' });
  }

  // ───────────────────────────── Planning ─────────────────────────────

  async submitObjective(projectId: string, objective: string, opts: { autoRun?: boolean } = {}): Promise<Plan> {
    const project = this.projects.update(projectId, { objective, status: 'planning' });
    const orch = await this.ensureOrchestrator(projectId);
    this.agents.setStatus(orch.id, 'working', 'Planning');
    this.messages.send(projectId, { kind: 'user', toAgentId: orch.id, body: objective, meta: { event: 'objective' } });
    this.log(projectId, 'Analyzing objective…');
    const roles = this.roles.list();
    let plan: Plan;
    const llm = this.planners.llm;
    try {
      if (llm) this.log(projectId, 'Creating architecture with Claude planner…');
      else this.log(projectId, 'No LLM configured — using heuristic planner templates.', 'warn');
      plan = await (llm ?? this.planners.heuristic).plan(objective, roles);
    } catch (e) {
      this.log(projectId, `LLM planner failed (${(e as Error).message}); falling back to heuristic planner.`, 'warn');
      plan = await this.planners.heuristic.plan(objective, roles);
    }
    this.log(projectId, `Plan: ${plan.summary}`);
    await this.applyPlan(projectId, plan, orch, project.settings.defaultRuntime);
    this.agents.setStatus(orch.id, 'idle', null);
    this.projects.update(projectId, { status: opts.autoRun === false ? 'idle' : 'running' });
    if (opts.autoRun !== false) this.log(projectId, 'Coordinating agents…', 'success');
    return plan;
  }

  async applyPlan(projectId: string, plan: Plan, orch: Agent, runtime: RuntimeKind) {
    const teamIds = new Map<string, string>();
    const existingTeams = this.teams.list(projectId);
    for (const t of plan.teams) teamIds.set(t.name, existingTeams.find((x) => x.name === t.name)?.id ?? this.teams.create(projectId, { name: t.name }).id);
    this.log(projectId, `Spawning ${plan.agents.length} agents across ${plan.teams.length} teams…`);
    const agentIds = new Map<string, string>();
    // Leads first so members can report to them.
    const ordered = [...plan.agents].sort((a, b) => Number(Boolean(b.lead)) - Number(Boolean(a.lead)));
    for (const pa of ordered) {
      const parentId = pa.reportsTo ? agentIds.get(pa.reportsTo) ?? orch.id : orch.id;
      const a = await this.agents.spawn(projectId, { roleId: pa.roleId, name: pa.name, teamId: teamIds.get(pa.team) ?? null, parentId, runtime, quiet: true });
      agentIds.set(pa.key, a.id);
      if (pa.lead) this.teams.update(teamIds.get(pa.team)!, { leadAgentId: a.id });
      this.log(projectId, `✓ ${this.roles.find(pa.roleId)?.icon ?? '•'} ${pa.name}`, 'success');
    }
    const taskIds = new Map<string, string>();
    const settings = this.projects.get(projectId).settings;
    // Topological insert so dependency ids exist.
    const remaining = [...plan.tasks];
    while (remaining.length) {
      const idx = remaining.findIndex((t) => t.dependsOn.every((d) => taskIds.has(d)));
      const t = remaining.splice(idx === -1 ? 0 : idx, 1)[0];
      const created = this.tasks.create(
        projectId,
        {
          title: t.title,
          description: t.description,
          priority: t.priority,
          assignedAgentId: agentIds.get(t.agent) ?? null,
          roleHint: plan.agents.find((a) => a.key === t.agent)?.roleId ?? null,
          dependsOn: t.dependsOn.map((d) => taskIds.get(d)).filter((x): x is string => Boolean(x)),
          requiresApproval: t.requiresApproval,
        },
        { maxAttempts: settings.maxTaskAttempts },
      );
      taskIds.set(t.key, created.id);
    }
    this.messages.send(projectId, {
      kind: 'broadcast',
      fromAgentId: orch.id,
      body: `Plan ready (${plan.planner}): ${plan.agents.length} agents, ${plan.tasks.length} tasks. ${plan.summary}`,
      meta: { fromName: orch.name, event: 'plan' },
    });
  }

  run(projectId: string) {
    const p = this.projects.update(projectId, { status: 'running' });
    for (const a of this.agents.list(projectId)) if (a.status === 'paused') this.resumeAgent(a.id);
    this.log(projectId, '▶ Orchestration running', 'success');
    void this.tick();
    return p;
  }

  halt(projectId: string) {
    const p = this.projects.update(projectId, { status: 'paused' });
    for (const a of this.agents.list(projectId)) if (this.runner.isRunning(a.id)) this.pauseAgent(a.id);
    this.log(projectId, '⏸ Orchestration paused — running agents pause at their next checkpoint', 'warn');
    return p;
  }

  // ───────────────────────────── Agent control ─────────────────────────────

  pauseAgent(agentId: string): Agent {
    this.runner.pause(agentId);
    return this.agents.setStatus(agentId, 'paused', 'Paused by user');
  }

  resumeAgent(agentId: string): Agent {
    const running = this.runner.resume(agentId);
    return this.agents.setStatus(agentId, running ? 'working' : 'idle', null);
  }

  stopAgent(agentId: string): Agent {
    this.runner.stop(agentId);
    return this.agents.setStatus(agentId, 'stopped', 'Stopped by user');
  }

  async removeAgent(agentId: string, deleteBranch = false) {
    const a = this.agents.get(agentId);
    if (a.roleId === 'orchestrator' && this.agents.list(a.projectId).length > 1) throw new HttpError(400, 'Remove the other agents before the orchestrator.');
    this.runner.stop(agentId);
    await this.runner.waitIdle(agentId);
    await this.agents.remove(agentId, { deleteBranch });
  }

  retryAgent(agentId: string): Agent {
    const a = this.agents.get(agentId);
    const failed = this.core.repos.tasks.where("assigned_agent_id = ? AND status = 'failed' ORDER BY updated_at DESC LIMIT 1", agentId)[0];
    if (failed) this.retryTask(failed.id);
    return this.agents.update(a.id, { status: 'idle', statusReason: null, retries: a.retries + 1 });
  }

  // ───────────────────────────── Task control ─────────────────────────────

  retryTask(taskId: string): Task {
    const t = this.tasks.get(taskId);
    if (['working', 'testing'].includes(t.status)) throw new HttpError(400, 'Task is running');
    const agent = this.agents.find(t.assignedAgentId);
    if (agent && ['failed', 'stopped'].includes(agent.status)) this.agents.update(agent.id, { status: 'idle', statusReason: null });
    this.log(t.projectId, `↻ Retrying “${t.title}”`);
    return this.tasks.setStatus(taskId, 'backlog', { attempts: 0, error: null, completedAt: null });
  }

  cancelTask(taskId: string): Task {
    const t = this.tasks.get(taskId);
    const agent = this.agents.find(t.assignedAgentId);
    const updated = this.tasks.setStatus(taskId, 'cancelled');
    if (agent && agent.currentTaskId === taskId) {
      this.runner.stop(agent.id);
      this.agents.setStatus(agent.id, 'idle', 'Task cancelled');
    }
    return updated;
  }

  reassignTask(taskId: string, agentId: string | null): Task {
    const t = this.tasks.get(taskId);
    if (['working', 'testing'].includes(t.status)) throw new HttpError(400, 'Stop the task before reassigning it');
    if (agentId) {
      const a = this.agents.get(agentId);
      if (a.projectId !== t.projectId) throw new HttpError(400, 'Agent belongs to another project');
    }
    const status = ['failed', 'cancelled', 'blocked'].includes(t.status) ? 'backlog' : t.status;
    return this.tasks.update(taskId, { assignedAgentId: agentId, status, error: null, attempts: 0 });
  }

  /** Send feedback and put a task back to work (code viewer "request changes"). */
  requestChanges(taskId: string, feedback: string): Task {
    const t = this.tasks.get(taskId);
    this.messages.send(t.projectId, { kind: 'user', toAgentId: t.assignedAgentId, taskId, body: `Changes requested: ${feedback}`, meta: { event: 'request-changes' } });
    for (const mr of this.core.repos.merges.where("task_id = ? AND status IN ('queued','awaiting_approval')", taskId)) {
      if (mr.status === 'awaiting_approval') this.merges.decide(mr.id, false);
      else this.core.repos.merges.update(mr.id, { status: 'rejected', error: 'Changes requested' });
    }
    return this.tasks.setStatus(taskId, 'backlog', {
      attempts: 0,
      error: null,
      description: `${t.description}\n\n## Requested changes\n${feedback}`,
      completedAt: null,
    });
  }

  async spawnDebugger(taskId: string): Promise<{ agent: Agent; task: Task }> {
    const task = this.tasks.get(taskId);
    const existing = this.core.repos.tasks.where("fixes_task_id = ? AND kind = 'debug' AND status NOT IN ('failed','cancelled')", taskId)[0];
    if (existing) return { agent: this.agents.get(existing.assignedAgentId!), task: existing };
    const failedAgent = this.agents.find(task.assignedAgentId);
    const project = this.projects.get(task.projectId);
    const llmOk = this.runner.runtimeFor({ runtime: 'claude' } as Agent).available().ok;
    const runtime: RuntimeKind = task.recovery?.length ? 'scripted' : llmOk ? 'claude' : failedAgent?.runtime ?? project.settings.defaultRuntime;
    const orch = await this.ensureOrchestrator(task.projectId);
    this.log(task.projectId, `🐞 Spawning debugger for “${task.title}”`, 'warn');
    const dbg = await this.agents.spawn(task.projectId, {
      roleId: 'debugger',
      name: `Debugger · ${failedAgent?.name ?? task.title}`.slice(0, 60),
      teamId: failedAgent?.teamId ?? null,
      parentId: failedAgent?.parentId ?? orch.id,
      runtime,
      fromBranch: failedAgent?.branch ?? undefined,
    });
    const debugTask = this.tasks.create(
      task.projectId,
      {
        title: `Fix: ${task.title}`,
        description: `Diagnose and fix the failure of “${task.title}”.\n\nError:\n${task.error ?? 'unknown'}\n\nYour branch starts from ${failedAgent?.branch ?? 'main'} (the failing work). Make tests pass, commit, and complete.`,
        kind: 'debug',
        fixesTaskId: task.id,
        assignedAgentId: dbg.id,
        roleHint: 'debugger',
        priority: 9,
        script: task.recovery,
        status: 'queued',
      },
      { maxAttempts: 2 },
    );
    this.messages.send(task.projectId, {
      kind: 'direct',
      fromAgentId: orch.id,
      toAgentId: dbg.id,
      taskId: debugTask.id,
      body: `${failedAgent?.name ?? 'An agent'} failed “${task.title}”. Please investigate and fix.`,
      meta: { fromName: orch.name, toName: dbg.name, event: 'debug' },
    });
    return { agent: dbg, task: debugTask };
  }

  // ───────────────────────────── Runner hooks ─────────────────────────────

  async onTaskSucceeded(task: Task, agent: Agent, summary: string) {
    const project = this.projects.get(task.projectId);
    const role = this.roles.get(agent.roleId);
    const ahead = agent.branch ? (await this.core.git.aheadBehind(project.repoPath, agent.branch)).ahead : 0;
    if (agent.branch && ahead > 0 && role.permissions.includes('merge.request') && project.settings.autoMerge) {
      this.tasks.setStatus(task.id, 'review');
      this.agents.setStatus(agent.id, 'waiting', 'In merge queue');
      this.merges.enqueue(project.id, { agentId: agent.id, taskId: task.id, branch: agent.branch });
      this.messages.send(project.id, { kind: 'task', fromAgentId: agent.id, taskId: task.id, body: `“${task.title}” done — ${summary.slice(0, 300)} Merge requested for ${agent.branch}.`, meta: { fromName: agent.name, event: 'merge.request' } });
      this.merges.pump(project.id);
      return;
    }
    if (agent.branch && ahead > 0) {
      this.tasks.setStatus(task.id, 'review');
      this.agents.setStatus(agent.id, 'waiting', 'Awaiting manual merge');
      return;
    }
    this.completeTask(task, agent, summary);
  }

  private completeTask(task: Task, agent: Agent | undefined, summary: string) {
    this.tasks.setStatus(task.id, 'completed', { result: summary || task.result, error: null });
    if (agent) this.agents.setStatus(agent.id, 'completed', null);
    this.log(task.projectId, `✓ ${agent?.name ?? 'Agent'} completed “${task.title}”`, 'success');
    if (task.fixesTaskId) {
      const original = this.tasks.get(task.fixesTaskId);
      this.tasks.setStatus(original.id, 'completed', { result: `Resolved by ${agent?.name ?? 'a follow-up task'}: ${summary}`, error: null });
      const origAgent = this.agents.find(original.assignedAgentId);
      if (origAgent && origAgent.status === 'failed') this.agents.setStatus(origAgent.id, 'completed', `Fixed by ${agent?.name}`);
      this.messages.system(task.projectId, `✓ “${original.title}” recovered by ${agent?.name}`, { taskId: original.id, fromAgentId: agent?.id ?? null, meta: { event: 'recovered' } });
    }
  }

  async onTaskFailed(task: Task, agent: Agent, error: string, opts: { final?: boolean; noDebug?: boolean } = {}) {
    const current = this.tasks.get(task.id);
    if (current.status === 'cancelled') return;
    const project = this.projects.get(task.projectId);
    const short = error.split('\n')[0].slice(0, 240);
    if (!opts.final && current.attempts < current.maxAttempts) {
      this.tasks.setStatus(task.id, 'queued', { error });
      this.agents.update(agent.id, { status: 'idle', statusReason: `Retrying: ${short}`, retries: agent.retries + 1 });
      this.messages.system(project.id, `⚠ ${agent.name} failed “${task.title}”: ${short} — retrying (${current.attempts}/${current.maxAttempts})`, { fromAgentId: agent.id, taskId: task.id, meta: { event: 'retry' } });
      this.log(project.id, `↻ Retrying “${task.title}” (${current.attempts}/${current.maxAttempts})`, 'warn');
      return;
    }
    this.tasks.setStatus(task.id, 'failed', { error });
    this.agents.setStatus(agent.id, 'failed', short);
    this.messages.system(project.id, `❌ ${agent.name} failed “${task.title}”: ${short}`, { fromAgentId: agent.id, taskId: task.id, meta: { event: 'failed' } });
    this.log(project.id, `✗ “${task.title}” failed: ${short}`, 'error');
    if (project.settings.autoDebug && !opts.noDebug && (task.kind === 'work' || task.kind === 'conflict')) {
      try {
        await this.spawnDebugger(task.id);
      } catch (e) {
        this.log(project.id, `Could not spawn debugger: ${(e as Error).message}`, 'error');
      }
    } else if (task.kind === 'debug' && task.fixesTaskId) {
      this.log(project.id, `Debugger could not fix “${this.tasks.get(task.fixesTaskId).title}” — human attention needed`, 'error');
    }
  }

  onTaskInterrupted(task: Task, agent: Agent) {
    const t = this.tasks.get(task.id);
    if (t.status !== 'cancelled') this.tasks.setStatus(task.id, 'queued', { attempts: Math.max(0, t.attempts - 1), assignedAgentId: agent.status === 'stopped' ? null : t.assignedAgentId });
  }

  // ───────────────────────────── Merge hooks ─────────────────────────────

  async onMerged(mr: MergeRequest) {
    const task = mr.taskId ? this.core.repos.tasks.get(mr.taskId) : undefined;
    const agent = this.agents.find(mr.agentId);
    this.messages.system(mr.projectId, `⛙ Merged ${mr.branch} into main${mr.mergedCommit ? ` (${mr.mergedCommit.slice(0, 7)})` : ''}`, { fromAgentId: mr.agentId, taskId: mr.taskId, meta: { event: 'merged', commit: mr.mergedCommit } });
    if (task) this.completeTask(task, agent, task.result ?? 'Merged');
    else if (agent) this.agents.setStatus(agent.id, 'completed', null);
  }

  async onFailed(mr: MergeRequest, step: MergeStep, error: string) {
    const task = mr.taskId ? this.core.repos.tasks.get(mr.taskId) : undefined;
    const agent = this.agents.find(mr.agentId);
    this.log(mr.projectId, `⛔ Merge of ${mr.branch} stopped at ${step}: ${error}`, 'error');
    if (task && agent) await this.onTaskFailed(task, agent, `Merge check “${step}” failed: ${error}`, step === 'approval' ? { final: true, noDebug: true } : {});
  }

  async onConflict(mr: MergeRequest, files: string[]) {
    const task = mr.taskId ? this.core.repos.tasks.get(mr.taskId) : undefined;
    const agent = this.agents.find(mr.agentId);
    this.log(mr.projectId, `⚠ ${mr.branch} conflicts with main in ${files.join(', ')}`, 'warn');
    if (!task || !agent) return;
    if (agent.runtime === 'claude') {
      this.tasks.setStatus(task.id, 'waiting', { error: `Merge conflict in ${files.join(', ')}` });
      this.tasks.create(
        mr.projectId,
        {
          title: `Resolve conflicts: ${task.title}`,
          description: `main has moved on and your branch conflicts in: ${files.join(', ')}. main has been merged into your worktree with conflict markers. Resolve every conflict keeping both intents, run tests, commit, complete.`,
          kind: 'conflict',
          fixesTaskId: task.id,
          assignedAgentId: agent.id,
          priority: 9,
          status: 'queued',
        },
        { maxAttempts: 2 },
      );
      this.agents.setStatus(agent.id, 'idle', 'Resolving merge conflicts');
    } else {
      await this.onTaskFailed(task, agent, `Merge conflict with main in ${files.join(', ')}`, { final: true });
    }
  }

  // ───────────────────────────── Scheduler ─────────────────────────────

  private isAvailable(a: Agent) {
    return !this.runner.isRunning(a.id) && !['paused', 'stopped', 'waiting', 'working', 'communicating'].includes(a.status) && !this.spawning.has(a.id);
  }

  async tick() {
    if (this.ticking) return;
    this.ticking = true;
    const nowTs = Date.now();
    const delta = nowTs - this.lastTick;
    this.lastTick = nowTs;
    try {
      for (const project of this.projects.list()) {
        this.updateAgentUsage(project.id, delta);
        if (project.status === 'running') {
          await this.schedule(project.id);
          this.merges.pump(project.id);
          this.checkCompletion(project.id);
        }
        const { metrics, resources } = this.metrics(project.id);
        this.core.bus.emit({ type: 'metrics.tick', projectId: project.id, metrics, resources });
      }
    } catch (e) {
      console.error('[orchestrator] tick failed', e);
    } finally {
      this.ticking = false;
    }
  }

  private updateAgentUsage(projectId: string, delta: number) {
    for (const a of this.agents.list(projectId)) {
      const running = this.runner.isRunning(a.id);
      const u = this.core.pm.agentUsage(a.id);
      if (!running && a.cpu === 0 && a.memMb === 0) continue;
      const patch: Partial<Agent> = { cpu: Math.round(u.cpu * 10) / 10, memMb: Math.round(u.memMb * 10) / 10 };
      if (running && a.status !== 'paused') patch.runtimeMs = a.runtimeMs + delta;
      this.agents.update(a.id, patch);
    }
  }

  async schedule(projectId: string) {
    const project = this.projects.get(projectId);
    const tasks = this.tasks.list(projectId);
    const byId = new Map(tasks.map((t) => [t.id, t]));

    // 1. Dependency resolution.
    for (const t of tasks) {
      if (!['backlog', 'blocked', 'queued'].includes(t.status)) continue;
      const r = this.tasks.readiness(t, byId);
      const next = r === 'ready' ? 'queued' : r === 'blocked' ? 'blocked' : 'backlog';
      if (next !== t.status) byId.set(t.id, this.tasks.setStatus(t.id, next));
    }

    // 2. Resource-aware dispatch.
    const s = project.settings;
    const runningCount = this.runner.activeCount(projectId);
    let capacity = s.maxConcurrentTasks - runningCount;
    const usage = this.core.pm.totals(projectId);
    const resourceBlocked = usage.cpu > s.maxCpuPercent || usage.memMb > s.maxMemoryMb;
    const agents = this.agents.list(projectId);
    const queued = [...byId.values()]
      .filter((t) => t.status === 'queued')
      .sort((a, b) => b.priority - a.priority || (this.agents.find(b.assignedAgentId)?.priority ?? 0) - (this.agents.find(a.assignedAgentId)?.priority ?? 0) || a.createdAt - b.createdAt);

    for (const t of queued) {
      let agent = this.agents.find(t.assignedAgentId);
      if (agent && agent.status === 'stopped') {
        this.tasks.update(t.id, { assignedAgentId: null });
        agent = undefined;
      }
      if (!agent) {
        const role = this.roles.match(t.roleHint);
        agent = agents.find((a) => a.roleId === role.id && this.isAvailable(a) && !queued.some((q) => q !== t && q.assignedAgentId === a.id));
        if (!agent) {
          // Dynamic scaling: spawn a new agent for this role if allowed.
          if (!this.spawning.has(t.id) && this.agents.countLive(projectId) < s.maxAgents) {
            this.spawning.add(t.id);
            const orch = await this.ensureOrchestrator(projectId);
            const teamId = agents.find((a) => a.roleId === role.id)?.teamId ?? null;
            this.agents
              .spawn(projectId, { roleId: role.id, name: `${role.name} ${agents.filter((a) => a.roleId === role.id).length + 1}`, parentId: orch.id, teamId, runtime: s.defaultRuntime })
              .then((a) => {
                this.tasks.update(t.id, { assignedAgentId: a.id });
                this.log(projectId, `⤴ Scaled up: spawned ${a.name} for “${t.title}”`);
              })
              .catch((e) => this.log(projectId, `Could not spawn agent: ${(e as Error).message}`, 'error'))
              .finally(() => this.spawning.delete(t.id));
          }
          continue;
        }
        this.tasks.update(t.id, { assignedAgentId: agent.id });
      }
      if (!this.isAvailable(agent)) continue;
      const runtime = this.runner.runtimeFor(agent);
      const avail = runtime.available();
      if (!avail.ok) {
        if (agent.statusReason !== avail.reason) this.agents.update(agent.id, { status: 'queued', statusReason: avail.reason ?? 'Runtime unavailable' });
        continue;
      }
      if (capacity <= 0 || resourceBlocked) {
        const reason = resourceBlocked ? 'Waiting for CPU/memory headroom' : `Waiting for a free slot (max ${s.maxConcurrentTasks} concurrent)`;
        if (agent.status !== 'queued' || agent.statusReason !== reason) this.agents.update(agent.id, { status: 'queued', statusReason: reason });
        continue;
      }
      capacity--;
      this.tasks.setStatus(t.id, 'assigned');
      this.runner.start(agent, this.tasks.get(t.id)).catch((e) => this.log(projectId, `Runner crashed: ${(e as Error).message}`, 'error'));
    }
  }

  private checkCompletion(projectId: string) {
    const tasks = this.tasks.list(projectId);
    if (!tasks.length) return;
    if (!tasks.every((t) => TERMINAL_TASK_STATUSES.includes(t.status))) return;
    if (this.runner.activeCount(projectId) > 0 || this.merges.isBusy(projectId)) return;
    const failed = tasks.filter((t) => t.status === 'failed');
    const agents = this.agents.list(projectId);
    const tokens = agents.reduce((s, a) => s + a.tokensIn + a.tokensOut, 0);
    const cost = agents.reduce((s, a) => s + a.costUsd, 0);
    const merged = this.core.repos.merges.where("project_id = ? AND status = 'merged'", projectId).length;
    this.projects.update(projectId, { status: failed.length ? 'failed' : 'completed' });
    const orch = this.orchestratorAgent(projectId);
    const summary = `Objective ${failed.length ? 'finished with failures' : 'complete'}: ${tasks.length - failed.length}/${tasks.length} tasks completed, ${merged} branches merged, ${agents.length} agents, ${tokens.toLocaleString()} tokens ($${cost.toFixed(2)}).${failed.length ? ` Failed: ${failed.map((t) => t.title).join(', ')}.` : ''}`;
    this.messages.send(projectId, { kind: 'broadcast', fromAgentId: orch?.id ?? null, body: summary, meta: { fromName: 'Orchestrator', event: 'summary' } });
    this.log(projectId, summary, failed.length ? 'warn' : 'success');
  }

  // ───────────────────────────── Metrics ─────────────────────────────

  metrics(projectId: string): { metrics: ProjectMetrics; resources: ResourceSnapshot } {
    const agents = this.agents.list(projectId);
    const tasks = this.tasks.list(projectId);
    const count = (st: Task['status'][]) => tasks.filter((t) => st.includes(t.status)).length;
    const tokens = agents.reduce((s, a) => s + a.tokensIn + a.tokensOut, 0);
    const costUsd = agents.reduce((s, a) => s + a.costUsd, 0);
    const usage = this.core.pm.totals(projectId);
    const latestMr = this.core.repos.merges.where('project_id = ? ORDER BY updated_at DESC LIMIT 1', projectId)[0];
    const tested = tasks.filter((t) => t.tests).sort((a, b) => (b.tests!.at ?? 0) - (a.tests!.at ?? 0))[0];
    const testsStatus: ProjectMetrics['tests'] = tasks.some((t) => t.status === 'testing') ? 'running' : tested ? (tested.tests!.ok ? 'passing' : 'failing') : 'unknown';
    let build: ProjectMetrics['build'] = 'unknown';
    if (latestMr) {
      const c = latestMr.checks;
      if (['checking', 'merging'].includes(latestMr.status)) build = 'running';
      else if (c.build.status === 'failed' || c.integration.status === 'failed') build = 'failing';
      else if (latestMr.status === 'merged') build = 'passing';
    }
    const started = agents.map((a) => a.startedAt).filter((x): x is number => Boolean(x));
    const metrics: ProjectMetrics = {
      activeAgents: agents.filter((a) => ['working', 'communicating', 'waiting'].includes(a.status)).length,
      totalAgents: agents.length,
      completedTasks: count(['completed']),
      runningTasks: count(['working', 'testing', 'assigned']),
      failedTasks: count(['failed']),
      blockedTasks: count(['blocked']),
      reviewTasks: count(['review']),
      queuedTasks: count(['queued']),
      totalTasks: tasks.length,
      tokens,
      costUsd,
      cpu: usage.cpu,
      memMb: usage.memMb,
      build,
      tests: testsStatus,
      branches: agents.filter((a) => a.branch).length + 1,
      commits: agents.reduce((s, a) => s + a.commits, 0),
      uptimeMs: started.length ? Date.now() - Math.min(...started) : 0,
    };
    const resources: ResourceSnapshot = {
      at: Date.now(),
      hostCpuPercent: hostCpuPercent(),
      hostMemUsedMb: (os.totalmem() - os.freemem()) / 1048576,
      hostMemTotalMb: os.totalmem() / 1048576,
      agentCpuPercent: usage.cpu,
      agentMemMb: usage.memMb,
      runningProcesses: usage.processes,
      activeAgents: metrics.activeAgents,
      runningTasks: metrics.runningTasks,
      queuedTasks: metrics.queuedTasks,
      tokensTotal: tokens,
      costUsd,
    };
    return { metrics, resources };
  }
}
