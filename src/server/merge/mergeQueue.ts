import fs from 'node:fs';
import path from 'node:path';
import type { MergeRequest, MergeStep, Project } from '../../shared/types.js';
import { MERGE_STEPS } from '../../shared/types.js';
import type { Core } from '../core.js';
import type { ApprovalService } from '../approvals/approvalService.js';
import type { ProjectService } from '../projects/projectService.js';
import type { TaskService } from '../tasks/taskService.js';
import type { AgentService } from '../agents/agentService.js';
import { agentHome } from '../process/processManager.js';
import { parseTestOutput } from '../tasks/testParser.js';
import { HttpError, id, now } from '../util.js';

export interface MergeHooks {
  onMerged(mr: MergeRequest): Promise<void>;
  onFailed(mr: MergeRequest, step: MergeStep, error: string): Promise<void>;
  onConflict(mr: MergeRequest, files: string[]): Promise<void>;
}

class StepFailure extends Error {
  constructor(public step: MergeStep, message: string) {
    super(message);
  }
}

const SYSTEM_PERMS = ['fs.read', 'fs.write', 'exec', 'exec.network'] as const;

/**
 * Serial per-project merge pipeline:
 * tests → conflicts → lint → build → integration (main+branch) → approval → merge.
 */
export class MergeQueue {
  private active = new Set<string>();
  private draining = false;
  hooks: MergeHooks | null = null;

  constructor(
    private core: Core,
    private projects: ProjectService,
    private tasks: TaskService,
    private agents: AgentService,
    private approvals: ApprovalService,
  ) {
    // Anything mid-flight when the server stopped goes back to the queue.
    this.core.db.run("UPDATE merge_requests SET status = 'queued' WHERE status IN ('checking','merging','awaiting_approval')");
  }

  list(projectId: string): MergeRequest[] {
    return this.core.repos.merges.where('project_id = ? ORDER BY created_at DESC LIMIT 200', projectId);
  }

  get(mergeId: string): MergeRequest {
    const m = this.core.repos.merges.get(mergeId);
    if (!m) throw new HttpError(404, 'Merge request not found');
    return m;
  }

  enqueue(projectId: string, input: { agentId: string | null; taskId: string | null; branch: string }): MergeRequest {
    const existing = this.core.repos.merges.where("project_id = ? AND branch = ? AND status IN ('queued','checking','awaiting_approval','merging')", projectId, input.branch)[0];
    if (existing) return existing;
    const checks = Object.fromEntries(MERGE_STEPS.map((s) => [s, { status: 'pending' as const }])) as MergeRequest['checks'];
    const mr: MergeRequest = { id: id('mr'), projectId, agentId: input.agentId, taskId: input.taskId, branch: input.branch, status: 'queued', checks, conflictFiles: [], mergedCommit: null, error: null, createdAt: now(), updatedAt: now() };
    this.core.repos.merges.insert(mr);
    this.emit(mr);
    return mr;
  }

  retry(mergeId: string): MergeRequest {
    const mr = this.get(mergeId);
    if (!['failed', 'conflict', 'rejected'].includes(mr.status)) throw new HttpError(400, `Cannot retry a ${mr.status} merge`);
    const checks = Object.fromEntries(MERGE_STEPS.map((s) => [s, { status: 'pending' as const }])) as MergeRequest['checks'];
    return this.update(mr.id, { status: 'queued', checks, error: null, conflictFiles: [] });
  }

  /** Approve/reject a merge waiting at the approval gate. */
  decide(mergeId: string, approved: boolean): MergeRequest {
    const mr = this.get(mergeId);
    const approvalId = mr.checks.approval.detail;
    if (mr.status !== 'awaiting_approval' || !approvalId) throw new HttpError(400, 'Merge is not awaiting approval');
    this.approvals.resolve(approvalId, approved, approved ? 'approved from merge queue' : 'rejected from merge queue');
    return this.get(mergeId);
  }

  /** Wait for in-flight pipelines to finish (shutdown); queued ones stay queued. */
  async drain(timeoutMs = 8000): Promise<void> {
    this.draining = true;
    const deadline = Date.now() + timeoutMs;
    while (this.active.size && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
  }

  isBusy(projectId: string) {
    return this.active.has(projectId) || this.core.repos.merges.where("project_id = ? AND status IN ('queued','checking','awaiting_approval','merging')", projectId).length > 0;
  }

  /** Start the next queued merge for a project if none is running. */
  pump(projectId: string): void {
    if (this.draining || this.active.has(projectId)) return;
    const next = this.core.repos.merges.where("project_id = ? AND status = 'queued' ORDER BY created_at LIMIT 1", projectId)[0];
    if (!next) return;
    this.active.add(projectId);
    this.process(next)
      .catch((e) => this.core.logs.line(projectId, next.agentId, next.taskId, 'system', `merge pipeline crashed: ${(e as Error).message}`))
      .finally(() => {
        this.active.delete(projectId);
        this.pump(projectId);
      });
  }

  private update(mergeId: string, patch: Partial<MergeRequest>): MergeRequest {
    this.core.repos.merges.update(mergeId, { ...patch, updatedAt: now() });
    const mr = this.get(mergeId);
    this.emit(mr);
    return mr;
  }

  private setCheck(mr: MergeRequest, step: MergeStep, status: MergeRequest['checks'][MergeStep]['status'], detail?: string, durationMs?: number): MergeRequest {
    const fresh = this.get(mr.id);
    const checks = { ...fresh.checks, [step]: { status, detail, durationMs } };
    return this.update(mr.id, { checks });
  }

  private async runSystem(project: Project, mr: MergeRequest, command: string, cwd: string) {
    return this.core.pm.run({
      projectId: project.id,
      agentId: mr.agentId,
      taskId: mr.taskId,
      command,
      cwd,
      permissions: [...SYSTEM_PERMS],
      timeoutSec: 900,
      maxMemoryMb: 6144,
      home: agentHome(this.core.config.dataDir, mr.agentId ?? `merge-${project.id}`),
      mounts: [project.repoPath],
    });
  }

  private needsPackageJson(cmd: string, dir: string) {
    return /^(npm|pnpm|yarn)\b/.test(cmd) && !fs.existsSync(path.join(dir, 'package.json'));
  }

  private async step(mr: MergeRequest, step: MergeStep, fn: () => Promise<string | { skip: string }>): Promise<MergeRequest> {
    const t0 = Date.now();
    mr = this.setCheck(mr, step, 'running');
    this.core.logs.line(mr.projectId, mr.agentId, mr.taskId, 'system', `› merge check: ${step}`);
    try {
      const out = await fn();
      if (typeof out === 'object') return this.setCheck(mr, step, 'skipped', out.skip, Date.now() - t0);
      return this.setCheck(mr, step, 'passed', out, Date.now() - t0);
    } catch (e) {
      this.setCheck(mr, step, 'failed', (e as Error).message.slice(0, 500), Date.now() - t0);
      throw e instanceof StepFailure ? e : new StepFailure(step, (e as Error).message);
    }
  }

  async process(mrIn: MergeRequest): Promise<void> {
    let mr = this.update(mrIn.id, { status: 'checking', error: null });
    const project = this.projects.get(mr.projectId);
    const agent = this.agents.find(mr.agentId);
    const task = mr.taskId ? this.core.repos.tasks.get(mr.taskId) : undefined;
    const worktree = agent?.workspacePath && fs.existsSync(agent.workspacePath) ? agent.workspacePath : null;
    const s = project.settings;

    try {
      if (!(await this.core.git.branchExists(project.repoPath, mr.branch))) throw new StepFailure('tests', `Branch ${mr.branch} does not exist`);
      const { ahead } = await this.core.git.aheadBehind(project.repoPath, mr.branch);
      if (ahead === 0) {
        for (const st of MERGE_STEPS) mr = this.setCheck(mr, st, 'skipped', 'nothing to merge');
        mr = this.update(mr.id, { status: 'merged', mergedCommit: await this.core.git.head(project.repoPath, 'main') });
        await this.hooks?.onMerged(mr);
        return;
      }

      mr = await this.step(mr, 'tests', async () => {
        if (!s.testCommand || !worktree) return { skip: !s.testCommand ? 'no test command configured' : 'no worktree' };
        if (this.needsPackageJson(s.testCommand, worktree)) return { skip: 'no package.json' };
        const head = await this.core.git.head(project.repoPath, mr.branch);
        if (task?.tests?.ok && task.tests.head === head) return `${task.tests.passed} passed (verified at ${head.slice(0, 7)})`;
        const r = await this.runSystem(project, mr, s.testCommand, worktree);
        const counts = parseTestOutput(`${r.stdout}\n${r.stderr}`);
        if (!r.ok) throw new StepFailure('tests', `Tests failed${counts ? ` (${counts.failed} failed)` : ''}`);
        return counts ? `${counts.passed} passed` : 'passed';
      });

      mr = await this.step(mr, 'conflicts', async () => {
        const c = await this.core.git.checkConflicts(project.repoPath, mr.branch);
        if (!c.clean) {
          this.update(mr.id, { conflictFiles: c.files });
          throw new StepFailure('conflicts', `Conflicts with main in ${c.files.join(', ')}`);
        }
        return 'clean';
      });

      for (const [step, cmd] of [['lint', s.lintCommand], ['build', s.buildCommand]] as const) {
        mr = await this.step(mr, step, async () => {
          if (!cmd || !worktree) return { skip: cmd ? 'no worktree' : `no ${step} command configured` };
          if (this.needsPackageJson(cmd, worktree)) return { skip: 'no package.json' };
          const r = await this.runSystem(project, mr, cmd, worktree);
          if (!r.ok) throw new StepFailure(step, `${step} failed (exit ${r.code})`);
          return 'passed';
        });
      }

      mr = await this.step(mr, 'integration', async () => {
        const cmd = s.integrationCommand || s.testCommand;
        if (!cmd) return { skip: 'no integration/test command configured' };
        const dir = path.join(this.projects.workspaceDir(project.id), 'integration', mr.id);
        return this.core.git.withIntegrationTree(project.repoPath, mr.branch, dir, async (tree) => {
          if (this.needsPackageJson(cmd, tree)) return { skip: 'no package.json' } as const;
          for (const src of [worktree, project.repoPath]) {
            const nm = src && path.join(src, 'node_modules');
            if (nm && fs.existsSync(nm) && !fs.existsSync(path.join(tree, 'node_modules'))) fs.symlinkSync(nm, path.join(tree, 'node_modules'));
          }
          const r = await this.runSystem(project, mr, cmd, tree);
          const counts = parseTestOutput(`${r.stdout}\n${r.stderr}`);
          if (!r.ok) throw new StepFailure('integration', `Integration run failed on main+${mr.branch}${counts ? ` (${counts.failed} failed)` : ''}`);
          return counts ? `${counts.passed} passed on main+branch` : 'passed on main+branch';
        });
      });

      if (s.requireApproval || task?.requiresApproval) {
        const approval = this.approvals.create(project.id, mr.agentId, 'merge', `Merge ${mr.branch} into main${task ? ` (“${task.title}”)` : ''}`, { mergeId: mr.id, branch: mr.branch });
        mr = this.setCheck(mr, 'approval', 'running', approval.id);
        mr = this.update(mr.id, { status: 'awaiting_approval' });
        this.core.logs.line(project.id, mr.agentId, mr.taskId, 'system', `⏸ Merge of ${mr.branch} awaits human approval`);
        const ok = await this.approvals.wait(approval.id, { timeoutMs: 24 * 3600_000 });
        if (!ok) {
          this.setCheck(mr, 'approval', 'failed', 'rejected by reviewer');
          mr = this.update(mr.id, { status: 'rejected', error: 'Rejected by reviewer' });
          await this.hooks?.onFailed(mr, 'approval', 'Merge rejected by reviewer');
          return;
        }
        mr = this.setCheck(mr, 'approval', 'passed', 'approved');
        mr = this.update(mr.id, { status: 'checking' });
      } else {
        mr = this.setCheck(mr, 'approval', 'skipped', 'not required');
      }

      mr = this.update(mr.id, { status: 'merging' });
      const t0 = Date.now();
      mr = this.setCheck(mr, 'merge', 'running');
      const commit = await this.core.git.mergeIntoBase(project.repoPath, mr.branch, `merge: ${mr.branch}${task ? ` — ${task.title}` : ''}`);
      mr = this.setCheck(mr, 'merge', 'passed', commit.slice(0, 7), Date.now() - t0);
      mr = this.update(mr.id, { status: 'merged', mergedCommit: commit });
      const info = (await this.core.git.log(project.repoPath, 'main', 1))[0];
      if (info) this.core.bus.emit({ type: 'git.commit', projectId: project.id, agentId: null, branch: 'main', commit: { ...info, branch: 'main' } });
      this.core.bus.emit({ type: 'git.branch', projectId: project.id, agentId: mr.agentId, branch: mr.branch, action: 'merged' });
      this.core.logs.line(project.id, mr.agentId, mr.taskId, 'system', `⇢ Merged ${mr.branch} into main at ${commit.slice(0, 7)}`);
      await this.hooks?.onMerged(mr);
    } catch (e) {
      const failure = e instanceof StepFailure ? e : new StepFailure('merge', (e as Error).message);
      if (failure.step === 'conflicts') {
        mr = this.update(mr.id, { status: 'conflict', error: failure.message });
        await this.hooks?.onConflict(mr, this.get(mr.id).conflictFiles);
      } else {
        mr = this.update(mr.id, { status: 'failed', error: failure.message });
        await this.hooks?.onFailed(mr, failure.step, failure.message);
      }
    }
  }

  emit(mr: MergeRequest) {
    this.core.bus.emit({ type: 'merge.upserted', projectId: mr.projectId, merge: mr });
  }
}
