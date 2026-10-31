import type { SQLInputValue } from 'node:sqlite';
import type {
  Agent,
  Approval,
  Link,
  LogLine,
  LogStream,
  MergeRequest,
  Message,
  Project,
  RoleDefinition,
  Task,
  Team,
} from '../../shared/types.js';
import type { Db, Row } from './database.js';

type Kind = 'plain' | 'json' | 'bool';
type ColumnMap<T> = { [K in keyof T]?: [column: string, kind?: Kind] };

/**
 * A small typed table mapper: domain objects (camelCase, rich types) <-> SQLite rows
 * (snake_case, JSON text, 0/1 booleans).
 */
export class Table<T extends { id: string }> {
  private readonly fields: [keyof T, string, Kind][];

  constructor(
    protected db: Db,
    readonly table: string,
    columns: ColumnMap<T>,
  ) {
    this.fields = Object.entries(columns).map(([f, v]) => {
      const [col, kind] = v as [string, Kind | undefined];
      return [f as keyof T, col, kind ?? 'plain'];
    });
  }

  fromRow(row: Row): T {
    const out: Record<string, unknown> = {};
    for (const [f, col, kind] of this.fields) {
      const v = row[col];
      if (kind === 'json') out[f as string] = v == null ? null : JSON.parse(String(v));
      else if (kind === 'bool') out[f as string] = Boolean(v);
      else out[f as string] = v ?? null;
    }
    return out as T;
  }

  private toValue(field: keyof T, value: unknown): SQLInputValue {
    const kind = this.fields.find((x) => x[0] === field)?.[2];
    if (value === undefined || value === null) return null;
    if (kind === 'json') return JSON.stringify(value);
    if (kind === 'bool') return value ? 1 : 0;
    return value as SQLInputValue;
  }

  insert(obj: T): T {
    const cols = this.fields.map((f) => f[1]);
    const vals = this.fields.map(([f]) => this.toValue(f, obj[f]));
    this.db.run(`INSERT INTO ${this.table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`, ...vals);
    return obj;
  }

  update(id: string, patch: Partial<T>): void {
    const entries = this.fields.filter(([f]) => f !== 'id' && Object.prototype.hasOwnProperty.call(patch, f));
    if (!entries.length) return;
    const sets = entries.map(([, col]) => `${col} = ?`).join(', ');
    const vals = entries.map(([f]) => this.toValue(f, patch[f]));
    this.db.run(`UPDATE ${this.table} SET ${sets} WHERE id = ?`, ...vals, id);
  }

  get(id: string): T | undefined {
    const row = this.db.get(`SELECT * FROM ${this.table} WHERE id = ?`, id);
    return row ? this.fromRow(row) : undefined;
  }

  where(clause: string, ...params: SQLInputValue[]): T[] {
    return this.db.all(`SELECT * FROM ${this.table} WHERE ${clause}`, ...params).map((r) => this.fromRow(r));
  }

  all(order = ''): T[] {
    return this.db.all(`SELECT * FROM ${this.table} ${order}`).map((r) => this.fromRow(r));
  }

  delete(id: string): void {
    this.db.run(`DELETE FROM ${this.table} WHERE id = ?`, id);
  }
}

export class Repositories {
  readonly projects: Table<Project>;
  readonly teams: Table<Team>;
  readonly agents: Table<Agent>;
  readonly tasks: TaskTable;
  readonly messages: Table<Message>;
  readonly links: Table<Link>;
  readonly merges: Table<MergeRequest>;
  readonly approvals: Table<Approval>;
  readonly roles: Table<StoredRole>;
  readonly logs: LogRepo;
  readonly settings: SettingsRepo;

  constructor(readonly db: Db) {
    this.projects = new Table<Project>(db, 'projects', {
      id: ['id'], name: ['name'], description: ['description'], objective: ['objective'], status: ['status'],
      repoPath: ['repo_path'], settings: ['settings', 'json'], createdAt: ['created_at'], updatedAt: ['updated_at'],
    });
    this.teams = new Table<Team>(db, 'teams', {
      id: ['id'], projectId: ['project_id'], name: ['name'], color: ['color'], leadAgentId: ['lead_agent_id'],
      parentTeamId: ['parent_team_id'], collapsed: ['collapsed', 'bool'], createdAt: ['created_at'],
    });
    this.agents = new Table<Agent>(db, 'agents', {
      id: ['id'], projectId: ['project_id'], teamId: ['team_id'], parentId: ['parent_id'], roleId: ['role_id'],
      name: ['name'], status: ['status'], statusReason: ['status_reason'], runtime: ['runtime'], model: ['model'],
      branch: ['branch'], workspacePath: ['workspace_path'], priority: ['priority'], currentTaskId: ['current_task_id'],
      posX: ['pos_x'], posY: ['pos_y'], tokensIn: ['tokens_in'], tokensOut: ['tokens_out'], tokenBudget: ['token_budget'],
      costUsd: ['cost_usd'], cpu: ['cpu'], memMb: ['mem_mb'], runtimeMs: ['runtime_ms'], startedAt: ['started_at'],
      filesChanged: ['files_changed'], testsPassed: ['tests_passed'], testsFailed: ['tests_failed'], commits: ['commits'],
      retries: ['retries'], createdAt: ['created_at'], updatedAt: ['updated_at'],
    });
    this.tasks = new TaskTable(db);
    this.messages = new Table<Message>(db, 'messages', {
      id: ['id'], projectId: ['project_id'], kind: ['kind'], fromAgentId: ['from_agent_id'], toAgentId: ['to_agent_id'],
      teamId: ['team_id'], taskId: ['task_id'], body: ['body'], meta: ['meta', 'json'], createdAt: ['created_at'],
    });
    this.links = new Table<Link>(db, 'links', {
      id: ['id'], projectId: ['project_id'], sourceAgentId: ['source_agent_id'], targetAgentId: ['target_agent_id'],
      kind: ['kind'], createdAt: ['created_at'],
    });
    this.merges = new Table<MergeRequest>(db, 'merge_requests', {
      id: ['id'], projectId: ['project_id'], agentId: ['agent_id'], taskId: ['task_id'], branch: ['branch'],
      status: ['status'], checks: ['checks', 'json'], conflictFiles: ['conflict_files', 'json'],
      mergedCommit: ['merged_commit'], error: ['error'], createdAt: ['created_at'], updatedAt: ['updated_at'],
    });
    this.approvals = new Table<Approval>(db, 'approvals', {
      id: ['id'], projectId: ['project_id'], agentId: ['agent_id'], kind: ['kind'], payload: ['payload', 'json'],
      status: ['status'], reason: ['reason'], createdAt: ['created_at'], resolvedAt: ['resolved_at'],
    });
    this.roles = new Table<StoredRole>(db, 'roles', {
      id: ['id'], name: ['name'], icon: ['icon'], color: ['color'], description: ['description'],
      systemPrompt: ['system_prompt'], capabilities: ['capabilities', 'json'], tools: ['tools', 'json'],
      permissions: ['permissions', 'json'], preferredModel: ['preferred_model'], taskTypes: ['task_types', 'json'],
      priority: ['priority'], limits: ['limits', 'json'], createdAt: ['created_at'],
    });
    this.logs = new LogRepo(db);
    this.settings = new SettingsRepo(db);
  }
}

type TaskRow = Omit<Task, 'dependsOn'>;
export type StoredRole = Omit<RoleDefinition, 'builtin'> & { createdAt: number };

export class TaskTable {
  private t: Table<TaskRow & { id: string }>;

  constructor(private db: Db) {
    this.t = new Table<TaskRow>(db, 'tasks', {
      id: ['id'], projectId: ['project_id'], title: ['title'], description: ['description'], kind: ['kind'], fixesTaskId: ['fixes_task_id'], priority: ['priority'],
      status: ['status'], assignedAgentId: ['assigned_agent_id'], roleHint: ['role_hint'], branch: ['branch'],
      script: ['script', 'json'], recovery: ['recovery', 'json'], requiresApproval: ['requires_approval', 'bool'],
      attempts: ['attempts'], maxAttempts: ['max_attempts'], files: ['files', 'json'], tests: ['tests', 'json'],
      result: ['result'], error: ['error'], createdAt: ['created_at'], startedAt: ['started_at'],
      completedAt: ['completed_at'], updatedAt: ['updated_at'],
    });
  }

  private withDeps(rows: TaskRow[]): Task[] {
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    const deps = this.db.all<{ task_id: string; depends_on_id: string }>(
      `SELECT task_id, depends_on_id FROM task_dependencies WHERE task_id IN (${ids.map(() => '?').join(',')})`,
      ...ids,
    );
    const map = new Map<string, string[]>();
    for (const d of deps) map.set(d.task_id, [...(map.get(d.task_id) ?? []), d.depends_on_id]);
    return rows.map((r) => ({ ...r, dependsOn: map.get(r.id) ?? [] }));
  }

  insert(task: Task): Task {
    const { dependsOn, ...row } = task;
    this.db.tx(() => {
      this.t.insert(row);
      for (const d of dependsOn) this.addDependency(task.id, d);
    });
    return task;
  }

  update(id: string, patch: Partial<Task>): void {
    const { dependsOn: _ignored, ...rest } = patch;
    this.t.update(id, rest);
  }

  get(id: string): Task | undefined {
    const r = this.t.get(id);
    return r ? this.withDeps([r])[0] : undefined;
  }

  byProject(projectId: string): Task[] {
    return this.withDeps(this.t.where('project_id = ? ORDER BY created_at', projectId));
  }

  where(clause: string, ...params: SQLInputValue[]): Task[] {
    return this.withDeps(this.t.where(clause, ...params));
  }

  delete(id: string): void {
    this.t.delete(id);
  }

  addDependency(taskId: string, dependsOnId: string): void {
    this.db.run('INSERT OR IGNORE INTO task_dependencies (task_id, depends_on_id) VALUES (?, ?)', taskId, dependsOnId);
  }

  removeDependency(taskId: string, dependsOnId: string): void {
    this.db.run('DELETE FROM task_dependencies WHERE task_id = ? AND depends_on_id = ?', taskId, dependsOnId);
  }

  dependents(taskId: string): string[] {
    return this.db
      .all<{ task_id: string }>('SELECT task_id FROM task_dependencies WHERE depends_on_id = ?', taskId)
      .map((r) => r.task_id);
  }
}

export class LogRepo {
  constructor(private db: Db) {}

  insertMany(lines: Omit<LogLine, 'id'>[]): LogLine[] {
    return this.db.tx(() =>
      lines.map((l) => {
        const r = this.db.run(
          'INSERT INTO logs (project_id, agent_id, task_id, stream, line, created_at) VALUES (?, ?, ?, ?, ?, ?)',
          l.projectId, l.agentId, l.taskId, l.stream, l.line, l.createdAt,
        );
        return { ...l, id: r.lastInsertRowid };
      }),
    );
  }

  forAgent(agentId: string, limit = 2000, afterId = 0): LogLine[] {
    return this.db
      .all<Row>('SELECT * FROM (SELECT * FROM logs WHERE agent_id = ? AND id > ? ORDER BY id DESC LIMIT ?) ORDER BY id', agentId, afterId, limit)
      .map(mapLog);
  }

  forProject(projectId: string, limit = 500): LogLine[] {
    return this.db
      .all<Row>('SELECT * FROM (SELECT * FROM logs WHERE project_id = ? ORDER BY id DESC LIMIT ?) ORDER BY id', projectId, limit)
      .map(mapLog);
  }

  search(projectId: string, q: string, limit = 20): LogLine[] {
    return this.db
      .all<Row>("SELECT * FROM logs WHERE project_id = ? AND line LIKE ? AND stream = 'stderr' ORDER BY id DESC LIMIT ?", projectId, `%${q}%`, limit)
      .map(mapLog);
  }

  /** Bound log growth per agent to keep the DB lean. */
  prune(agentId: string, keep = 20000): void {
    this.db.run(
      'DELETE FROM logs WHERE agent_id = ? AND id < (SELECT COALESCE(MIN(id), 0) FROM (SELECT id FROM logs WHERE agent_id = ? ORDER BY id DESC LIMIT ?))',
      agentId, agentId, keep,
    );
  }
}

function mapLog(r: Row): LogLine {
  return {
    id: Number(r.id),
    projectId: String(r.project_id),
    agentId: (r.agent_id as string) ?? null,
    taskId: (r.task_id as string) ?? null,
    stream: r.stream as LogStream,
    line: String(r.line),
    createdAt: Number(r.created_at),
  };
}

export class SettingsRepo {
  constructor(private db: Db) {}
  get<T>(key: string, fallback: T): T {
    const r = this.db.get<{ value: string }>('SELECT value FROM settings WHERE key = ?', key);
    return r ? (JSON.parse(r.value) as T) : fallback;
  }
  set(key: string, value: unknown): void {
    this.db.run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, JSON.stringify(value));
  }
}
