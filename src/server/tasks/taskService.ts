import type { ScriptStep, Task, TaskKind, TaskStatus } from '../../shared/types.js';
import { TERMINAL_TASK_STATUSES } from '../../shared/types.js';
import type { Core } from '../core.js';
import { HttpError, id, now } from '../util.js';

export interface CreateTaskInput {
  title: string;
  description?: string;
  priority?: number;
  roleHint?: string | null;
  assignedAgentId?: string | null;
  dependsOn?: string[];
  script?: ScriptStep[] | null;
  recovery?: ScriptStep[] | null;
  requiresApproval?: boolean;
  kind?: TaskKind;
  fixesTaskId?: string | null;
  maxAttempts?: number;
  status?: TaskStatus;
}

/** Task CRUD, dependency DAG (cycle-checked) and status transitions. */
export class TaskService {
  constructor(private core: Core) {}

  list(projectId: string): Task[] {
    return this.core.repos.tasks.byProject(projectId);
  }

  get(taskId: string): Task {
    const t = this.core.repos.tasks.get(taskId);
    if (!t) throw new HttpError(404, 'Task not found');
    return t;
  }

  create(projectId: string, input: CreateTaskInput, defaults: { maxAttempts: number }): Task {
    const deps = Array.from(new Set(input.dependsOn ?? []));
    for (const d of deps) {
      const dep = this.core.repos.tasks.get(d);
      if (!dep || dep.projectId !== projectId) throw new HttpError(400, `Unknown dependency ${d}`);
    }
    const task: Task = {
      id: id('tsk'),
      projectId,
      title: input.title.trim().slice(0, 200) || 'Untitled task',
      description: input.description ?? '',
      kind: input.kind ?? 'work',
      fixesTaskId: input.fixesTaskId ?? null,
      priority: clampPriority(input.priority ?? 5),
      status: input.status ?? 'backlog',
      assignedAgentId: input.assignedAgentId ?? null,
      roleHint: input.roleHint ?? null,
      branch: null,
      script: input.script ?? null,
      recovery: input.recovery ?? null,
      requiresApproval: Boolean(input.requiresApproval),
      attempts: 0,
      maxAttempts: Math.max(1, input.maxAttempts ?? defaults.maxAttempts),
      files: [],
      tests: null,
      result: null,
      error: null,
      dependsOn: deps,
      createdAt: now(),
      startedAt: null,
      completedAt: null,
      updatedAt: now(),
    };
    this.core.repos.tasks.insert(task);
    this.emit(task);
    return task;
  }

  update(taskId: string, patch: Partial<Task>): Task {
    this.get(taskId);
    this.core.repos.tasks.update(taskId, { ...patch, updatedAt: now() });
    const t = this.get(taskId);
    this.emit(t);
    return t;
  }

  setStatus(taskId: string, status: TaskStatus, extra: Partial<Task> = {}): Task {
    const patch: Partial<Task> = { status, ...extra };
    const t = this.get(taskId);
    if (status === 'working' && !t.startedAt) patch.startedAt = now();
    if (TERMINAL_TASK_STATUSES.includes(status)) patch.completedAt = now();
    return this.update(taskId, patch);
  }

  /** Would adding taskId → dependsOnId create a cycle? */
  wouldCycle(taskId: string, dependsOnId: string): boolean {
    if (taskId === dependsOnId) return true;
    const seen = new Set<string>();
    const stack = [dependsOnId];
    while (stack.length) {
      const cur = stack.pop()!;
      if (cur === taskId) return true;
      if (seen.has(cur)) continue;
      seen.add(cur);
      const t = this.core.repos.tasks.get(cur);
      if (t) stack.push(...t.dependsOn);
    }
    return false;
  }

  addDependency(taskId: string, dependsOnId: string): Task {
    const t = this.get(taskId);
    const d = this.get(dependsOnId);
    if (t.projectId !== d.projectId) throw new HttpError(400, 'Dependencies must be in the same project');
    if (this.wouldCycle(taskId, dependsOnId)) throw new HttpError(400, 'That dependency would create a cycle');
    this.core.repos.tasks.addDependency(taskId, dependsOnId);
    if (!TERMINAL_TASK_STATUSES.includes(t.status) && d.status !== 'completed' && ['queued', 'assigned'].includes(t.status))
      return this.setStatus(taskId, 'backlog');
    return this.update(taskId, {});
  }

  removeDependency(taskId: string, dependsOnId: string): Task {
    this.core.repos.tasks.removeDependency(taskId, dependsOnId);
    return this.update(taskId, {});
  }

  /** Dependency readiness: 'ready' | 'waiting' | 'blocked' (a dependency failed/cancelled). */
  readiness(task: Task, byId: Map<string, Task>): 'ready' | 'waiting' | 'blocked' {
    let waiting = false;
    for (const d of task.dependsOn) {
      const dep = byId.get(d);
      if (!dep) continue;
      if (dep.status === 'failed' || dep.status === 'cancelled') return 'blocked';
      if (dep.status !== 'completed') waiting = true;
    }
    return waiting ? 'waiting' : 'ready';
  }

  delete(taskId: string): void {
    const t = this.get(taskId);
    this.core.repos.tasks.delete(taskId);
    this.core.bus.emit({ type: 'task.removed', projectId: t.projectId, taskId });
  }

  emit(task: Task) {
    this.core.bus.emit({ type: 'task.upserted', projectId: task.projectId, task });
  }
}

function clampPriority(p: number) {
  return Math.max(0, Math.min(10, Math.round(p)));
}
