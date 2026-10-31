import fs from 'node:fs';
import type { Agent, AgentStatus, RuntimeKind } from '../../shared/types.js';
import { SCRIPTED_MODEL } from '../../shared/pricing.js';
import type { Core } from '../core.js';
import type { RoleService } from '../roles/roleService.js';
import type { ProjectService } from '../projects/projectService.js';
import type { MessageService } from '../messages/messageService.js';
import { HttpError, id, now, slug } from '../util.js';

export interface SpawnInput {
  roleId: string;
  name?: string;
  teamId?: string | null;
  parentId?: string | null;
  runtime?: RuntimeKind;
  model?: string;
  priority?: number;
  /** Create a git worktree (default: every role except the orchestrator). */
  worktree?: boolean;
  /** Branch the new agent's branch starts from (default main). Used by debuggers. */
  fromBranch?: string;
  posX?: number | null;
  posY?: number | null;
  quiet?: boolean;
}

const ACTIVE: AgentStatus[] = ['working', 'communicating', 'waiting'];

export class AgentService {
  constructor(
    private core: Core,
    private roles: RoleService,
    private projects: ProjectService,
    private messages: MessageService,
  ) {}

  list(projectId: string): Agent[] {
    return this.core.repos.agents.where('project_id = ? ORDER BY created_at', projectId);
  }

  get(agentId: string): Agent {
    const a = this.core.repos.agents.get(agentId);
    if (!a) throw new HttpError(404, 'Agent not found');
    return a;
  }

  find(agentId: string | null | undefined): Agent | undefined {
    return agentId ? this.core.repos.agents.get(agentId) : undefined;
  }

  countLive(projectId: string): number {
    return this.list(projectId).filter((a) => a.status !== 'stopped').length;
  }

  isActive(a: Agent) {
    return ACTIVE.includes(a.status);
  }

  async spawn(projectId: string, input: SpawnInput): Promise<Agent> {
    const project = this.projects.get(projectId);
    const role = this.roles.get(input.roleId);
    if (this.countLive(projectId) >= project.settings.maxAgents)
      throw new HttpError(409, `Agent limit reached (${project.settings.maxAgents}). Raise MAX AGENTS in resource settings.`);
    const agentId = id('agt');
    const name = (input.name?.trim() || role.name).slice(0, 60);
    const runtime: RuntimeKind = input.runtime ?? project.settings.defaultRuntime;
    const wantsWorktree = input.worktree ?? role.id !== 'orchestrator';
    const branch = wantsWorktree ? `agent/${slug(name, 28)}-${agentId.slice(-4)}` : null;
    const agent: Agent = {
      id: agentId,
      projectId,
      teamId: input.teamId ?? null,
      parentId: input.parentId ?? null,
      roleId: role.id,
      name,
      status: 'idle',
      statusReason: null,
      runtime,
      model: runtime === 'scripted' ? SCRIPTED_MODEL : input.model || role.preferredModel || project.settings.defaultModel,
      branch,
      workspacePath: wantsWorktree ? this.projects.worktreeDir(projectId, agentId) : null,
      priority: input.priority ?? role.priority,
      currentTaskId: null,
      posX: input.posX ?? null,
      posY: input.posY ?? null,
      tokensIn: 0,
      tokensOut: 0,
      tokenBudget: role.limits.tokenBudget,
      costUsd: 0,
      cpu: 0,
      memMb: 0,
      runtimeMs: 0,
      startedAt: null,
      filesChanged: 0,
      testsPassed: 0,
      testsFailed: 0,
      commits: 0,
      retries: 0,
      createdAt: now(),
      updatedAt: now(),
    };
    this.core.repos.agents.insert(agent);
    this.emit(agent);
    if (branch && agent.workspacePath) {
      try {
        await this.core.git.ensureWorktree(project.repoPath, branch, agent.workspacePath, input.fromBranch ?? this.core.git.base);
        this.core.bus.emit({ type: 'git.branch', projectId, agentId, branch, action: 'created' });
      } catch (e) {
        this.update(agentId, { status: 'failed', statusReason: `Worktree creation failed: ${(e as Error).message}` });
        throw e;
      }
    }
    if (!input.quiet) {
      const parent = this.find(input.parentId);
      this.messages.system(projectId, `${parent ? `${parent.name} spawned` : 'Spawned'} ${role.icon} ${name}${branch ? ` on ${branch}` : ''}`, {
        fromAgentId: parent?.id ?? null,
        toAgentId: agentId,
        meta: { event: 'spawn' },
      });
    }
    return this.get(agentId);
  }

  update(agentId: string, patch: Partial<Agent>): Agent {
    const before = this.get(agentId);
    this.core.repos.agents.update(agentId, { ...patch, updatedAt: now() });
    const after = { ...before, ...patch, updatedAt: now() };
    this.emit(after);
    return after;
  }

  setStatus(agentId: string, status: AgentStatus, reason: string | null = null): Agent {
    const a = this.get(agentId);
    const patch: Partial<Agent> = { status, statusReason: reason };
    if (status === 'working' && !a.startedAt) patch.startedAt = now();
    return this.update(agentId, patch);
  }

  /** Remove an agent: its worktree is deleted; its branch is deleted only if requested. */
  async remove(agentId: string, opts: { deleteBranch?: boolean } = {}): Promise<void> {
    const a = this.get(agentId);
    const project = this.projects.get(a.projectId);
    this.core.pm.killAgent(agentId);
    if (a.workspacePath && fs.existsSync(a.workspacePath))
      await this.core.git.removeWorktree(project.repoPath, a.workspacePath, { deleteBranch: opts.deleteBranch && a.branch ? a.branch : undefined });
    if (opts.deleteBranch && a.branch) this.core.bus.emit({ type: 'git.branch', projectId: a.projectId, agentId, branch: a.branch, action: 'deleted' });
    this.core.db.tx(() => {
      this.core.db.run('UPDATE agents SET parent_id = ? WHERE parent_id = ?', a.parentId, agentId);
      this.core.db.run("UPDATE tasks SET assigned_agent_id = NULL WHERE assigned_agent_id = ? AND status NOT IN ('completed','failed','cancelled')", agentId);
      this.core.db.run('UPDATE teams SET lead_agent_id = NULL WHERE lead_agent_id = ?', agentId);
      this.core.db.run('DELETE FROM links WHERE source_agent_id = ? OR target_agent_id = ?', agentId, agentId);
      this.core.repos.agents.delete(agentId);
    });
    this.core.bus.emit({ type: 'agent.removed', projectId: a.projectId, agentId });
    for (const child of this.list(a.projectId).filter((c) => c.parentId === a.parentId)) this.emit(child);
    this.messages.system(a.projectId, `Removed agent ${a.name}`, { meta: { event: 'remove' } });
  }

  emit(agent: Agent) {
    this.core.bus.emit({ type: 'agent.upserted', projectId: agent.projectId, agent });
  }
}
