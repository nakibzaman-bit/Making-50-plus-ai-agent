/**
 * DEMO MODE — a browser-only simulation for exploring the interface.
 * Nothing here touches the server, the database, git or any process. Every log line it
 * produces is prefixed "[simulated]" and the UI shows a persistent DEMO banner.
 */
import type { ServerEvent } from '../../shared/events';
import type {
  Agent,
  AgentStatus,
  LogLine,
  MergeRequest,
  Message,
  Project,
  ProjectMetrics,
  ProjectSnapshot,
  ResourceSnapshot,
  RoleDefinition,
  Task,
  Team,
} from '../../shared/types';
import { MERGE_STEPS } from '../../shared/types';
import { BUILTIN_ROLES } from '../../shared/roles';
import { DEFAULT_PROJECT_SETTINGS, TEAM_COLORS } from '../../shared/defaults';
import type { Backend } from '../api/backend';

type Emit = (e: ServerEvent) => void;

const PID = 'demo_project';
const rnd = (n: number) => Math.floor(Math.random() * n);
const pick = <T,>(xs: T[]): T => xs[rnd(xs.length)];
let nextId = 1;
const uid = (p: string) => `${p}_demo${nextId++}`;

const TEAMS: { name: string; lead: [string, string]; members: [string, string][] }[] = [
  { name: 'Product', lead: ['project-manager', 'Product Manager'], members: [['research', 'Research Agent'], ['docs', 'Documentation Agent'], ['marketing', 'Marketing Agent']] },
  { name: 'Frontend', lead: ['team-lead', 'Frontend Lead'], members: [['frontend', 'UI Agent'], ['animation', 'Animation Agent'], ['designer', 'Accessibility Agent'], ['frontend', 'Dashboard Agent'], ['3d', '3D Viewer Agent'], ['graphics', 'Shader Agent']] },
  { name: 'Backend', lead: ['team-lead', 'Backend Lead'], members: [['api', 'API Agent'], ['database', 'Database Agent'], ['backend', 'Auth Agent'], ['backend', 'Payments Agent'], ['backend', 'Search Agent'], ['security', 'Security Agent']] },
  { name: 'AI', lead: ['ai', 'AI Lead'], members: [['ai', 'Agent Runtime'], ['ml', 'Ranking Model'], ['ml', 'Embeddings Agent'], ['ai', 'Evaluation Agent'], ['ai', 'Prompt Engineer']] },
  { name: 'Platform', lead: ['devops', 'Platform Lead'], members: [['cloud', 'Cloud Agent'], ['devops', 'CI Agent'], ['performance', 'Performance Agent'], ['devops', 'Release Agent']] },
  { name: 'Quality', lead: ['qa', 'QA Lead'], members: [['test', 'Unit Test Agent'], ['test', 'E2E Test Agent'], ['reviewer', 'Code Reviewer'], ['debugger', 'Debugger'], ['qa', 'Regression Agent'], ['reviewer', 'Security Reviewer']] },
];

const COMMANDS = ['npm run build', 'npm test', 'npx tsc --noEmit', 'npm run lint', 'git status', 'node scripts/migrate.js', 'npx vitest run src/'];
const CHATTER = [
  'API endpoint /users is missing.',
  'Endpoint implemented. Commit {hash}.',
  'Pulling changes.',
  'Schema migration ready for review.',
  'Can you expose the ranking score in the response?',
  'Integration tests started.',
  'Rebased on main, conflicts resolved.',
  'Found a race in the cart reservation — fixing.',
];

function baseAgent(partial: Partial<Agent> & Pick<Agent, 'id' | 'name' | 'roleId'>): Agent {
  const now = Date.now();
  return {
    projectId: PID, teamId: null, parentId: null, status: 'idle', statusReason: null, runtime: 'claude', model: pick(['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5']),
    branch: null, workspacePath: null, priority: 5, currentTaskId: null, posX: null, posY: null, tokensIn: 0, tokensOut: 0, tokenBudget: 2_000_000,
    costUsd: 0, cpu: 0, memMb: 0, runtimeMs: 0, startedAt: null, filesChanged: 0, testsPassed: 0, testsFailed: 0, commits: 0, retries: 0, createdAt: now, updatedAt: now, ...partial,
  };
}

export class DemoBackend implements Backend {
  readonly kind = 'demo' as const;
  private project: Project;
  private teams: Team[] = [];
  private agents = new Map<string, Agent>();
  private tasks = new Map<string, Task>();
  private merges = new Map<string, MergeRequest>();
  private messages: Message[] = [];
  private timer: number | null = null;
  private logId = 1;
  private emit: Emit = () => {};
  private startedAt = Date.now();
  private running = true;

  constructor() {
    const now = Date.now();
    this.project = { id: PID, name: 'DEMO · Orbital Commerce', description: 'Simulated workforce — no real processes.', objective: 'Build an AI-powered commerce platform (simulated).', status: 'running', repoPath: '(simulated)', settings: { ...DEFAULT_PROJECT_SETTINGS, maxConcurrentTasks: 24 }, createdAt: now, updatedAt: now };
    const orch = baseAgent({ id: 'agt_demo_orch', name: 'Orchestrator', roleId: 'orchestrator', status: 'working', model: 'claude-opus-5-5', startedAt: now });
    this.agents.set(orch.id, orch);
    TEAMS.forEach((t, i) => {
      const team: Team = { id: uid('team'), projectId: PID, name: t.name, color: TEAM_COLORS[i % TEAM_COLORS.length], leadAgentId: null, parentTeamId: null, collapsed: false, createdAt: now };
      this.teams.push(team);
      const lead = baseAgent({ id: uid('agt'), name: t.lead[1], roleId: t.lead[0], teamId: team.id, parentId: orch.id, branch: `agent/${t.lead[1].toLowerCase().replace(/\s+/g, '-')}`, priority: 7 });
      team.leadAgentId = lead.id;
      this.agents.set(lead.id, lead);
      for (const [role, name] of t.members) {
        const a = baseAgent({ id: uid('agt'), name, roleId: role, teamId: team.id, parentId: lead.id, branch: `agent/${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}` });
        this.agents.set(a.id, a);
      }
    });
    let prev: string | null = null;
    for (const a of this.agents.values()) {
      if (a.roleId === 'orchestrator') continue;
      for (let k = 0; k < 2; k++) {
        const t = this.makeTask(`${pick(['Implement', 'Refactor', 'Test', 'Wire up', 'Optimise', 'Document'])} ${a.name.replace(' Agent', '').toLowerCase()} ${pick(['module', 'endpoint', 'view', 'pipeline', 'schema', 'flow'])}`, a.id, prev && Math.random() < 0.3 ? [prev] : []);
        prev = t.id;
      }
    }
  }

  attach(emit: Emit) {
    this.emit = emit;
    if (this.timer) clearInterval(this.timer);
    this.timer = window.setInterval(() => this.step(), 380);
  }

  detach() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private makeTask(title: string, agentId: string, dependsOn: string[] = []): Task {
    const now = Date.now();
    const t: Task = { id: uid('tsk'), projectId: PID, title, description: '(simulated task)', kind: 'work', fixesTaskId: null, priority: rnd(10), status: 'queued', assignedAgentId: agentId, roleHint: null, branch: this.agents.get(agentId)?.branch ?? null, script: null, recovery: null, requiresApproval: Math.random() < 0.1, attempts: 0, maxAttempts: 2, files: [], tests: null, result: null, error: null, dependsOn, createdAt: now, startedAt: null, completedAt: null, updatedAt: now };
    this.tasks.set(t.id, t);
    return t;
  }

  private upsertAgent(a: Agent, patch: Partial<Agent>) {
    const next = { ...a, ...patch, updatedAt: Date.now() };
    this.agents.set(a.id, next);
    this.emit({ type: 'agent.upserted', projectId: PID, agent: next });
    return next;
  }

  private upsertTask(t: Task, patch: Partial<Task>) {
    const next = { ...t, ...patch, updatedAt: Date.now() };
    this.tasks.set(t.id, next);
    this.emit({ type: 'task.upserted', projectId: PID, task: next });
    return next;
  }

  private log(agentId: string, line: string, stream: LogLine['stream'] = 'stdout') {
    this.emit({ type: 'log.batch', projectId: PID, lines: [{ id: this.logId++, projectId: PID, agentId, taskId: null, stream, line: `[simulated] ${line}`, createdAt: Date.now() }] });
  }

  private message(from: Agent, to: Agent | null, body: string, kind: Message['kind'] = 'direct') {
    const m: Message = { id: uid('msg'), projectId: PID, kind, fromAgentId: from.id, toAgentId: to?.id ?? null, teamId: from.teamId, taskId: null, body, meta: { fromName: from.name, toName: to?.name }, createdAt: Date.now() };
    this.messages.push(m);
    this.emit({ type: 'message.created', projectId: PID, message: m });
  }

  private step() {
    if (!this.running) return;
    const agents = [...this.agents.values()].filter((a) => a.roleId !== 'orchestrator');
    for (let n = 0; n < 4; n++) {
      const a = pick(agents);
      const fresh = this.agents.get(a.id)!;
      if (['paused', 'stopped'].includes(fresh.status)) continue;
      if (['idle', 'completed', 'queued'].includes(fresh.status)) {
        const t = [...this.tasks.values()].find((x) => x.assignedAgentId === a.id && x.status === 'queued' && x.dependsOn.every((d) => this.tasks.get(d)?.status === 'completed'));
        if (t) {
          this.upsertTask(t, { status: 'working', startedAt: Date.now(), attempts: t.attempts + 1 });
          this.upsertAgent(fresh, { status: 'working', currentTaskId: t.id, startedAt: fresh.startedAt ?? Date.now(), statusReason: null });
          this.log(a.id, `$ ${pick(COMMANDS)}`, 'cmd');
        } else if (Math.random() < 0.02) {
          this.makeTask(`Follow-up: ${a.name.toLowerCase()} polish`, a.id);
        }
        continue;
      }
      if (fresh.status === 'working') {
        const r = Math.random();
        const patch: Partial<Agent> = { tokensIn: fresh.tokensIn + 800 + rnd(4000), tokensOut: fresh.tokensOut + 200 + rnd(900), cpu: 20 + rnd(160), memMb: 120 + rnd(900), runtimeMs: fresh.runtimeMs + 1500 };
        patch.costUsd = fresh.costUsd + ((patch.tokensIn! - fresh.tokensIn) * 4 + (patch.tokensOut! - fresh.tokensOut) * 20) / 1e6;
        if (r < 0.45) {
          this.log(a.id, pick(['✓ compiled 42 modules', 'running 18 tests…', `edited src/${a.name.split(' ')[0].toLowerCase()}/index.ts`, 'tsc: 0 errors', '# pass 31', 'wrote 3 files']));
          this.upsertAgent(fresh, patch);
        } else if (r < 0.6) {
          const to = pick(agents);
          this.upsertAgent(fresh, { ...patch, status: 'communicating' });
          this.message(fresh, to, pick(CHATTER).replace('{hash}', Math.random().toString(16).slice(2, 9)));
          setTimeout(() => {
            const cur = this.agents.get(a.id);
            if (cur?.status === 'communicating') this.upsertAgent(cur, { status: 'working' });
          }, 1400);
        } else if (r < 0.86) {
          const t = fresh.currentTaskId ? this.tasks.get(fresh.currentTaskId) : undefined;
          if (t) this.upsertTask(t, { status: 'review', files: [`src/${a.name.split(' ')[0].toLowerCase()}/index.ts`] });
          this.upsertAgent(fresh, { ...patch, status: 'waiting', statusReason: 'In merge queue', commits: fresh.commits + 1, filesChanged: fresh.filesChanged + 1 + rnd(6), testsPassed: fresh.testsPassed + 5 + rnd(30), cpu: 0, memMb: 0 });
          this.startMerge(this.agents.get(a.id)!, t);
        } else {
          const t = fresh.currentTaskId ? this.tasks.get(fresh.currentTaskId) : undefined;
          this.log(a.id, 'Error: build failed — TS2322 in src/index.ts', 'stderr');
          this.emit({ type: 'orchestrator.log', projectId: PID, line: `[simulated] ✗ ${a.name} failed — scheduling retry`, level: 'warn' });
          if (t) this.upsertTask(t, { status: t.attempts < t.maxAttempts ? 'queued' : 'failed', error: 'Build error (simulated)' });
          this.upsertAgent(fresh, { ...patch, status: 'failed', statusReason: 'Build error (simulated)', testsFailed: fresh.testsFailed + 1 + rnd(3), cpu: 0, memMb: 0 });
          setTimeout(() => {
            const cur = this.agents.get(a.id);
            if (cur?.status === 'failed') this.upsertAgent(cur, { status: 'idle', statusReason: 'Retrying', retries: cur.retries + 1 });
          }, 4000);
        }
      }
    }
    this.tickMerges();
    this.emitMetrics();
  }

  private startMerge(a: Agent, t: Task | undefined) {
    const checks = Object.fromEntries(MERGE_STEPS.map((s) => [s, { status: 'pending' as const }])) as MergeRequest['checks'];
    const mr: MergeRequest = { id: uid('mr'), projectId: PID, agentId: a.id, taskId: t?.id ?? null, branch: a.branch ?? 'agent/x', status: 'checking', checks, conflictFiles: [], mergedCommit: null, error: null, createdAt: Date.now(), updatedAt: Date.now() };
    this.merges.set(mr.id, mr);
    this.emit({ type: 'merge.upserted', projectId: PID, merge: mr });
  }

  private tickMerges() {
    for (const mr of this.merges.values()) {
      if (!['checking', 'merging'].includes(mr.status)) continue;
      const step = MERGE_STEPS.find((s) => mr.checks[s].status !== 'passed' && mr.checks[s].status !== 'skipped');
      const next = { ...mr, checks: { ...mr.checks }, updatedAt: Date.now() };
      if (!step) continue;
      if (next.checks[step].status === 'pending') next.checks[step] = { status: 'running' };
      else if (Math.random() < 0.5) {
        if (step === 'conflicts' && Math.random() < 0.05) {
          next.checks[step] = { status: 'failed', detail: 'src/index.ts' };
          next.status = 'conflict';
        } else next.checks[step] = { status: ['lint', 'build'].includes(step) && Math.random() < 0.3 ? 'skipped' : 'passed' };
        if (step === 'merge' && next.checks.merge.status === 'passed') {
          next.status = 'merged';
          next.mergedCommit = Math.random().toString(16).slice(2, 42);
          const a = next.agentId ? this.agents.get(next.agentId) : undefined;
          const t = next.taskId ? this.tasks.get(next.taskId) : undefined;
          if (t) this.upsertTask(t, { status: 'completed', completedAt: Date.now() });
          if (a) this.upsertAgent(a, { status: 'completed', statusReason: null, currentTaskId: null });
          this.emit({ type: 'git.branch', projectId: PID, agentId: next.agentId, branch: next.branch, action: 'merged' });
          this.emit({ type: 'orchestrator.log', projectId: PID, line: `[simulated] ⇢ merged ${next.branch} into main`, level: 'success' });
        }
      }
      this.merges.set(next.id, next);
      this.emit({ type: 'merge.upserted', projectId: PID, merge: next });
    }
  }

  private computeMetrics(): { metrics: ProjectMetrics; resources: ResourceSnapshot } {
    const agents = [...this.agents.values()];
    const tasks = [...this.tasks.values()];
    const c = (st: Task['status'][]) => tasks.filter((t) => st.includes(t.status)).length;
    const tokens = agents.reduce((s, a) => s + a.tokensIn + a.tokensOut, 0);
    const cost = agents.reduce((s, a) => s + a.costUsd, 0);
    const cpu = agents.reduce((s, a) => s + a.cpu, 0);
    const mem = agents.reduce((s, a) => s + a.memMb, 0);
    const metrics: ProjectMetrics = {
      activeAgents: agents.filter((a) => ['working', 'communicating', 'waiting'].includes(a.status)).length, totalAgents: agents.length,
      completedTasks: c(['completed']), runningTasks: c(['working']), failedTasks: c(['failed']), blockedTasks: c(['blocked']), reviewTasks: c(['review']), queuedTasks: c(['queued']), totalTasks: tasks.length,
      tokens, costUsd: cost, cpu, memMb: mem, build: 'passing', tests: 'passing', branches: agents.length, commits: agents.reduce((s, a) => s + a.commits, 0), uptimeMs: Date.now() - this.startedAt,
    };
    return { metrics, resources: { at: Date.now(), hostCpuPercent: Math.min(100, cpu / 16), hostMemUsedMb: 6000 + mem, hostMemTotalMb: 32768, agentCpuPercent: cpu, agentMemMb: mem, runningProcesses: metrics.runningTasks * 2, activeAgents: metrics.activeAgents, runningTasks: metrics.runningTasks, queuedTasks: metrics.queuedTasks, tokensTotal: tokens, costUsd: cost } };
  }

  private emitMetrics() {
    const { metrics, resources } = this.computeMetrics();
    this.emit({ type: 'metrics.tick', projectId: PID, metrics, resources });
  }

  // ───────── Backend interface ─────────
  async system() {
    return { version: 'demo', platform: 'browser simulation', node: '-', executor: 'local' as const, runtimes: [{ kind: 'claude' as const, available: false, reason: 'DEMO MODE' }, { kind: 'scripted' as const, available: false, reason: 'DEMO MODE' }], llmConfigured: false, defaultModel: 'claude-opus-5-5', startedAt: this.startedAt };
  }
  async projects() {
    return [this.project];
  }
  async createProject(): Promise<Project> {
    throw new Error('Projects cannot be created in DEMO mode — switch to LIVE.');
  }
  async loadTestLab(): Promise<Project> {
    throw new Error('The Test Lab runs real agents — switch to LIVE.');
  }
  async deleteProject() {
    throw new Error('Not available in DEMO mode.');
  }
  async snapshot(): Promise<ProjectSnapshot> {
    const { metrics, resources } = this.computeMetrics();
    return { project: this.project, teams: this.teams, agents: [...this.agents.values()], tasks: [...this.tasks.values()], messages: this.messages, links: [], merges: [...this.merges.values()], approvals: [], metrics, resources };
  }
  async updateSettings(_id: string, s: Partial<Project['settings']>) {
    this.project = { ...this.project, settings: { ...this.project.settings, ...s } };
    this.emit({ type: 'project.updated', projectId: PID, project: this.project });
    return this.project;
  }
  async objective(_id: string, objective: string) {
    const orch = this.agents.get('agt_demo_orch')!;
    this.message(orch, null, `(simulated) New objective received: ${objective}`, 'broadcast');
    return { summary: 'Simulated plan', planner: 'demo', agents: 0, tasks: 0 };
  }
  async run() {
    this.running = true;
    this.project = { ...this.project, status: 'running' };
    this.emit({ type: 'project.updated', projectId: PID, project: this.project });
    return this.project;
  }
  async halt() {
    this.running = false;
    this.project = { ...this.project, status: 'paused' };
    this.emit({ type: 'project.updated', projectId: PID, project: this.project });
    return this.project;
  }
  async roles(): Promise<RoleDefinition[]> {
    return BUILTIN_ROLES;
  }
  async saveRole(): Promise<RoleDefinition> {
    throw new Error('Not available in DEMO mode.');
  }
  async deleteRole() {
    throw new Error('Not available in DEMO mode.');
  }
  async spawnAgent(_pid: string, input: { roleId: string; name?: string; teamId?: string | null; parentId?: string | null; count?: number }) {
    const out: Agent[] = [];
    for (let i = 0; i < (input.count ?? 1); i++) {
      const role = BUILTIN_ROLES.find((r) => r.id === input.roleId);
      const name = `${input.name ?? role?.name ?? 'Agent'}${(input.count ?? 1) > 1 ? ` ${i + 1}` : ''}`;
      const a = baseAgent({ id: uid('agt'), name, roleId: input.roleId, teamId: input.teamId ?? null, parentId: input.parentId ?? 'agt_demo_orch', branch: `agent/${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}` });
      this.agents.set(a.id, a);
      this.emit({ type: 'agent.upserted', projectId: PID, agent: a });
      this.makeTask(`Bootstrap ${name}`, a.id);
      out.push(a);
    }
    return out.length === 1 ? out[0] : out;
  }
  async updateAgent(id: string, p: Partial<Agent>) {
    return this.upsertAgent(this.agents.get(id)!, p);
  }
  async savePositions(_pid: string, positions: { id: string; x: number; y: number }[]) {
    for (const p of positions) {
      const a = this.agents.get(p.id);
      if (a) this.agents.set(a.id, { ...a, posX: p.x, posY: p.y });
    }
  }
  async deleteAgent(id: string) {
    this.agents.delete(id);
    this.emit({ type: 'agent.removed', projectId: PID, agentId: id });
  }
  async agentAction(id: string, action: string) {
    const a = this.agents.get(id)!;
    const map: Record<string, AgentStatus> = { pause: 'paused', resume: 'working', stop: 'stopped', retry: 'idle', debug: a.status, merge: a.status };
    return this.upsertAgent(a, { status: map[action] ?? a.status, statusReason: action === 'stop' ? 'Stopped by user' : null });
  }
  async runTests() {
    return { passed: 12, failed: 0, ok: true, command: '(simulated)', at: Date.now(), head: null };
  }
  async agentLogs() {
    return [];
  }
  async agentGit(id: string) {
    const a = this.agents.get(id)!;
    const c = Array.from({ length: a.commits }, (_, i) => ({ hash: `${i}`.padEnd(40, 'a'), shortHash: `demo${i}`, author: a.name, message: `(simulated) commit ${i + 1}`, date: Date.now() - i * 60000 }));
    return { branch: a.branch, base: 'main', workspacePath: '(simulated)', commits: c, changes: [{ path: 'src/index.ts', status: 'modified' as const, additions: 24, deletions: 6, staged: false, committed: true }], uncommitted: [], mergeStatus: null };
  }
  async agentFiles() {
    return ['README.md', 'package.json', 'src/index.ts'];
  }
  async agentFile(_id: string, _path: string, version: 'current' | 'base') {
    return { content: version === 'base' ? '// (simulated) previous version\nexport const value = 1;\n' : '// (simulated) current version\nexport const value = 2;\nexport const extra = true;\n' };
  }
  async agentDiff() {
    return { diff: '--- a/src/index.ts\n+++ b/src/index.ts\n@@ -1,2 +1,3 @@\n-// (simulated) previous version\n-export const value = 1;\n+// (simulated) current version\n+export const value = 2;\n+export const extra = true;\n' };
  }
  async revertFile() {
    return { ok: true };
  }
  async createTask(_pid: string, input: { title: string; assignedAgentId?: string | null; dependsOn?: string[] }) {
    const t = this.makeTask(input.title, input.assignedAgentId ?? pick([...this.agents.keys()]), input.dependsOn ?? []);
    this.emit({ type: 'task.upserted', projectId: PID, task: t });
    return t;
  }
  async taskAction(id: string, action: 'cancel' | 'retry') {
    return this.upsertTask(this.tasks.get(id)!, { status: action === 'cancel' ? 'cancelled' : 'queued', error: null });
  }
  async reassignTask(id: string, agentId: string | null) {
    return this.upsertTask(this.tasks.get(id)!, { assignedAgentId: agentId });
  }
  async requestChanges(id: string) {
    return this.upsertTask(this.tasks.get(id)!, { status: 'queued' });
  }
  async addDependency(id: string, dep: string) {
    const t = this.tasks.get(id)!;
    return this.upsertTask(t, { dependsOn: [...t.dependsOn, dep] });
  }
  async removeDependency(id: string, dep: string) {
    const t = this.tasks.get(id)!;
    return this.upsertTask(t, { dependsOn: t.dependsOn.filter((d) => d !== dep) });
  }
  async sendMessage(_pid: string, input: { body: string; toAgentId?: string | null }) {
    const m: Message = { id: uid('msg'), projectId: PID, kind: 'user', fromAgentId: null, toAgentId: input.toAgentId ?? null, teamId: null, taskId: null, body: input.body, meta: { fromName: 'You' }, createdAt: Date.now() };
    this.emit({ type: 'message.created', projectId: PID, message: m });
    return m;
  }
  async createTeam(_pid: string, name: string) {
    const t: Team = { id: uid('team'), projectId: PID, name, color: pick(TEAM_COLORS), leadAgentId: null, parentTeamId: null, collapsed: false, createdAt: Date.now() };
    this.teams.push(t);
    this.emit({ type: 'team.upserted', projectId: PID, team: t });
    return t;
  }
  async updateTeam(id: string, p: Partial<Team>) {
    const i = this.teams.findIndex((t) => t.id === id);
    this.teams[i] = { ...this.teams[i], ...p };
    this.emit({ type: 'team.upserted', projectId: PID, team: this.teams[i] });
    return this.teams[i];
  }
  async deleteTeam() {}
  async link() {
    return {};
  }
  async unlink() {}
  async branches() {
    return [{ name: 'main', head: 'demo', agentId: null, ahead: 0, behind: 0, merged: true, lastCommit: null, mergeStatus: null }, ...[...this.agents.values()].filter((a) => a.branch).map((a) => ({ name: a.branch!, head: 'demo', agentId: a.id, ahead: a.commits, behind: rnd(3), merged: a.status === 'completed', lastCommit: null, mergeStatus: null }))];
  }
  async commits() {
    return [];
  }
  async mergeAction(id: string, action: string) {
    const mr = this.merges.get(id);
    if (mr && action === 'retry') {
      const next = { ...mr, status: 'checking' as const };
      this.merges.set(id, next);
      this.emit({ type: 'merge.upserted', projectId: PID, merge: next });
    }
    return {};
  }
  async approval() {
    return {};
  }
  async search(_pid: string | null, q: string) {
    const ql = q.toLowerCase();
    return [...this.agents.values()].filter((a) => a.name.toLowerCase().includes(ql)).slice(0, 12).map((a) => ({ type: 'agent' as const, id: a.id, title: a.name, subtitle: `${a.roleId} · ${a.status} (simulated)`, projectId: PID, agentId: a.id }));
  }
}

export const demoBackend = new DemoBackend();
