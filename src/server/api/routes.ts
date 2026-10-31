import fs from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AgentGitState, BranchInfo, ProjectSnapshot, SystemInfo } from '../../shared/types.js';
import { AGENT_STATUSES } from '../../shared/types.js';
import type { Services } from '../services.js';
import { resolveInside } from '../security/sandbox.js';
import { HttpError } from '../util.js';
import { seedTestLab } from '../projects/testLab.js';

const VERSION = '0.1.0';

const settingsSchema = z
  .object({
    maxAgents: z.number().int().min(1).max(1000),
    maxConcurrentTasks: z.number().int().min(1).max(256),
    maxCpuPercent: z.number().min(10).max(10000),
    maxMemoryMb: z.number().min(128).max(1_000_000),
    testCommand: z.string().max(400),
    lintCommand: z.string().max(400),
    buildCommand: z.string().max(400),
    integrationCommand: z.string().max(400),
    requireApproval: z.boolean(),
    autoMerge: z.boolean(),
    autoDebug: z.boolean(),
    maxTaskAttempts: z.number().int().min(1).max(10),
    defaultModel: z.string().max(80),
    defaultRuntime: z.enum(['claude', 'scripted']),
  })
  .partial();

const scriptStep = z.discriminatedUnion('type', [
  z.object({ type: z.literal('write'), path: z.string(), content: z.string() }),
  z.object({ type: z.literal('append'), path: z.string(), content: z.string() }),
  z.object({ type: z.literal('run'), command: z.string(), allowFailure: z.boolean().optional() }),
  z.object({ type: z.literal('commit'), message: z.string() }),
  z.object({ type: z.literal('message'), to: z.string().optional(), toRole: z.string().optional(), team: z.boolean().optional(), body: z.string() }),
  z.object({ type: z.literal('sleep'), ms: z.number().int().min(0).max(10000) }),
]);

const limitsSchema = z.object({
  commandTimeoutSec: z.number().int().min(1).max(3600),
  maxMemoryMb: z.number().int().min(64).max(65536),
  maxIterations: z.number().int().min(1).max(500),
  tokenBudget: z.number().int().min(0),
});

const PERMISSIONS = ['fs.read', 'fs.write', 'exec', 'exec.network', 'git.commit', 'agents.spawn', 'tasks.create', 'merge.request', 'messages.broadcast'] as const;

export function registerRoutes(app: FastifyInstance, s: Services) {
  const parse = <T extends z.ZodTypeAny>(schema: T, data: unknown): z.infer<T> => {
    const r = schema.safeParse(data ?? {});
    if (!r.success) throw new HttpError(400, r.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '));
    return r.data;
  };
  const P = (req: { params: unknown }) => req.params as Record<string, string>;
  const Q = (req: { query: unknown }) => req.query as Record<string, string | undefined>;

  // ───────── System ─────────
  app.get('/api/health', async () => ({ ok: true, at: Date.now() }));

  app.get('/api/system', async (): Promise<SystemInfo> => {
    const executorOk = await s.core.pm.executorKind;
    return {
      version: VERSION,
      platform: `${process.platform} ${process.arch}`,
      node: process.version,
      executor: executorOk,
      runtimes: [
        { kind: 'claude', ...normalize(s.runtimes.claude.available()) },
        { kind: 'scripted', ...normalize(s.runtimes.scripted.available()) },
      ],
      llmConfigured: Boolean(s.config.anthropicApiKey),
      defaultModel: s.config.defaultModel,
      startedAt: startedAt,
    };
  });

  app.get('/api/processes', async () => s.core.pm.list());

  // ───────── Roles ─────────
  app.get('/api/roles', async () => s.roles.list());
  app.post('/api/roles', async (req) => {
    const body = parse(
      z.object({
        id: z.string().max(40).optional(),
        name: z.string().min(1).max(60),
        icon: z.string().max(8).default('🤖'),
        color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#60a5fa'),
        description: z.string().max(500).default(''),
        systemPrompt: z.string().min(1).max(20000),
        capabilities: z.array(z.string().max(40)).max(30).default([]),
        tools: z.array(z.string()).max(30),
        permissions: z.array(z.enum(PERMISSIONS)).max(PERMISSIONS.length),
        preferredModel: z.string().max(80).default(s.config.defaultModel),
        taskTypes: z.array(z.string().max(40)).max(30).default([]),
        priority: z.number().int().min(0).max(10).default(5),
        limits: limitsSchema.default({ commandTimeoutSec: 180, maxMemoryMb: 2048, maxIterations: 40, tokenBudget: 2_000_000 }),
      }),
      req.body,
    );
    return s.roles.upsert(body);
  });
  app.delete('/api/roles/:id', async (req) => {
    s.roles.delete(P(req).id);
    return { ok: true };
  });

  // ───────── Projects ─────────
  app.get('/api/projects', async () => s.projects.list());
  app.post('/api/projects', async (req) => {
    const body = parse(z.object({ name: z.string().min(1).max(80), description: z.string().max(1000).optional(), objective: z.string().max(10000).optional(), settings: settingsSchema.optional() }), req.body);
    const project = await s.projects.create(body);
    await s.orchestrator.ensureOrchestrator(project.id);
    return project;
  });
  app.post('/api/projects/test-lab', async () => {
    const id = await seedTestLab(s);
    return s.projects.get(id);
  });
  app.get('/api/projects/:id', async (req) => s.projects.get(P(req).id));
  app.patch('/api/projects/:id', async (req) => s.projects.update(P(req).id, parse(z.object({ name: z.string().min(1).max(80), description: z.string().max(1000), objective: z.string().max(10000) }).partial(), req.body)));
  app.patch('/api/projects/:id/settings', async (req) => s.projects.updateSettings(P(req).id, parse(settingsSchema, req.body)));
  app.delete('/api/projects/:id', async (req) => {
    const id = P(req).id;
    s.orchestrator.halt(id);
    for (const a of s.agents.list(id)) s.runner.stop(a.id);
    for (const a of s.agents.list(id)) await s.runner.waitIdle(a.id);
    s.projects.delete(id);
    return { ok: true };
  });

  app.get('/api/projects/:id/snapshot', async (req): Promise<ProjectSnapshot> => {
    const id = P(req).id;
    const project = s.projects.get(id);
    const { metrics, resources } = s.orchestrator.metrics(id);
    return {
      project,
      teams: s.teams.list(id),
      agents: s.agents.list(id),
      tasks: s.tasks.list(id),
      messages: s.messages.list(id, 400),
      links: s.teams.links(id),
      merges: s.merges.list(id),
      approvals: s.approvals.list(id),
      metrics,
      resources,
    };
  });

  app.post('/api/projects/:id/objective', async (req) => {
    const body = parse(z.object({ objective: z.string().min(3).max(10000), autoRun: z.boolean().optional() }), req.body);
    const plan = await s.orchestrator.submitObjective(P(req).id, body.objective, { autoRun: body.autoRun });
    return { summary: plan.summary, planner: plan.planner, agents: plan.agents.length, tasks: plan.tasks.length };
  });
  app.post('/api/projects/:id/run', async (req) => s.orchestrator.run(P(req).id));
  app.post('/api/projects/:id/halt', async (req) => s.orchestrator.halt(P(req).id));

  app.get('/api/projects/:id/logs', async (req) => s.core.repos.logs.forProject(P(req).id, Number(Q(req).limit ?? 500)));
  app.get('/api/projects/:id/search', async (req) => s.search.search(P(req).id, String(Q(req).q ?? '')));
  app.get('/api/search', async (req) => s.search.search(null, String(Q(req).q ?? '')));

  // ───────── Teams & links ─────────
  app.post('/api/projects/:id/teams', async (req) => s.teams.create(P(req).id, parse(z.object({ name: z.string().min(1).max(60), color: z.string().optional(), leadAgentId: z.string().nullable().optional() }), req.body)));
  app.patch('/api/teams/:id', async (req) => s.teams.update(P(req).id, parse(z.object({ name: z.string().min(1).max(60), color: z.string(), leadAgentId: z.string().nullable(), collapsed: z.boolean() }).partial(), req.body)));
  app.delete('/api/teams/:id', async (req) => {
    s.teams.delete(P(req).id);
    return { ok: true };
  });
  app.post('/api/projects/:id/links', async (req) => {
    const b = parse(z.object({ sourceAgentId: z.string(), targetAgentId: z.string() }), req.body);
    return s.teams.link(P(req).id, b.sourceAgentId, b.targetAgentId);
  });
  app.delete('/api/links/:id', async (req) => {
    s.teams.unlink(P(req).id);
    return { ok: true };
  });

  // ───────── Agents ─────────
  app.post('/api/projects/:id/agents', async (req) => {
    const b = parse(
      z.object({
        roleId: z.string(),
        name: z.string().max(60).optional(),
        teamId: z.string().nullable().optional(),
        parentId: z.string().nullable().optional(),
        runtime: z.enum(['claude', 'scripted']).optional(),
        model: z.string().max(80).optional(),
        priority: z.number().int().min(0).max(10).optional(),
        posX: z.number().nullable().optional(),
        posY: z.number().nullable().optional(),
        count: z.number().int().min(1).max(100).optional(),
      }),
      req.body,
    );
    const { count = 1, ...input } = b;
    const created = [];
    for (let i = 0; i < count; i++) created.push(await s.orchestrator.spawn(P(req).id, count > 1 ? { ...input, name: `${input.name ?? s.roles.get(input.roleId).name} ${i + 1}` } : input));
    return count > 1 ? created : created[0];
  });
  app.get('/api/agents/:id', async (req) => s.agents.get(P(req).id));
  app.patch('/api/agents/:id', async (req) => {
    const b = parse(
      z.object({
        name: z.string().min(1).max(60),
        priority: z.number().int().min(0).max(10),
        teamId: z.string().nullable(),
        parentId: z.string().nullable(),
        posX: z.number().nullable(),
        posY: z.number().nullable(),
        model: z.string().max(80),
        tokenBudget: z.number().int().min(0),
        runtime: z.enum(['claude', 'scripted']),
      }).partial(),
      req.body,
    );
    const a = s.agents.get(P(req).id);
    if (b.parentId === a.id) throw new HttpError(400, 'An agent cannot report to itself');
    return s.agents.update(a.id, b);
  });
  /** Batch position updates from the canvas (drag / auto-layout). */
  app.post('/api/projects/:id/positions', async (req) => {
    const b = parse(z.object({ positions: z.array(z.object({ id: z.string(), x: z.number(), y: z.number() })).max(2000) }), req.body);
    s.core.db.tx(() => {
      for (const p of b.positions) s.core.db.run('UPDATE agents SET pos_x = ?, pos_y = ? WHERE id = ? AND project_id = ?', p.x, p.y, p.id, P(req).id);
    });
    return { ok: true };
  });
  app.delete('/api/agents/:id', async (req) => {
    await s.orchestrator.removeAgent(P(req).id, Q(req).deleteBranch === 'true');
    return { ok: true };
  });
  app.post('/api/agents/:id/pause', async (req) => s.orchestrator.pauseAgent(P(req).id));
  app.post('/api/agents/:id/resume', async (req) => s.orchestrator.resumeAgent(P(req).id));
  app.post('/api/agents/:id/stop', async (req) => s.orchestrator.stopAgent(P(req).id));
  app.post('/api/agents/:id/retry', async (req) => s.orchestrator.retryAgent(P(req).id));
  app.post('/api/agents/:id/debug', async (req) => {
    const a = s.agents.get(P(req).id);
    const failed = s.core.repos.tasks.where("assigned_agent_id = ? AND status IN ('failed','review','queued','blocked') ORDER BY updated_at DESC LIMIT 1", a.id)[0];
    if (!failed) throw new HttpError(400, 'This agent has no failed task to debug');
    return s.orchestrator.spawnDebugger(failed.id);
  });
  app.post('/api/agents/:id/test', async (req) => {
    const a = s.agents.get(P(req).id);
    if (s.runner.isRunning(a.id)) throw new HttpError(409, 'Agent is busy');
    const r = await s.runner.runProjectTests(a, null);
    if (!r) throw new HttpError(400, 'No test command applies to this workspace');
    return r;
  });
  app.post('/api/agents/:id/merge', async (req) => {
    const a = s.agents.get(P(req).id);
    if (!a.branch) throw new HttpError(400, 'Agent has no branch');
    const task = s.core.repos.tasks.where("assigned_agent_id = ? AND status = 'review' ORDER BY updated_at DESC LIMIT 1", a.id)[0];
    const mr = s.merges.enqueue(a.projectId, { agentId: a.id, taskId: task?.id ?? null, branch: a.branch });
    s.merges.pump(a.projectId);
    return mr;
  });
  app.get('/api/agents/:id/logs', async (req) => s.core.repos.logs.forAgent(P(req).id, Math.min(Number(Q(req).limit ?? 2000), 10000), Number(Q(req).after ?? 0)));
  app.get('/api/agents/:id/messages', async (req) => s.messages.forAgent(P(req).id));
  app.get('/api/agents/:id/tasks', async (req) => s.core.repos.tasks.where('assigned_agent_id = ? ORDER BY created_at', P(req).id));

  app.get('/api/agents/:id/git', async (req): Promise<AgentGitState> => {
    const a = s.agents.get(P(req).id);
    const project = s.projects.get(a.projectId);
    if (!a.branch) return { branch: null, base: 'main', workspacePath: null, commits: await s.core.git.log(project.repoPath, 'main', 30), changes: [], uncommitted: [], mergeStatus: null };
    const exists = await s.core.git.branchExists(project.repoPath, a.branch);
    const mr = s.core.repos.merges.where('branch = ? ORDER BY created_at DESC LIMIT 1', a.branch)[0];
    return {
      branch: a.branch,
      base: 'main',
      workspacePath: a.workspacePath,
      commits: exists ? await s.core.git.branchCommits(project.repoPath, a.branch) : [],
      changes: exists ? await s.core.git.committedChanges(project.repoPath, a.branch) : [],
      uncommitted: a.workspacePath ? await s.core.git.workingChanges(a.workspacePath) : [],
      mergeStatus: mr?.status ?? null,
    };
  });
  app.get('/api/agents/:id/files', async (req) => {
    const a = s.agents.get(P(req).id);
    const dir = a.workspacePath && fs.existsSync(a.workspacePath) ? a.workspacePath : s.projects.get(a.projectId).repoPath;
    return s.core.git.listFiles(dir);
  });
  app.get('/api/agents/:id/file', async (req) => {
    const a = s.agents.get(P(req).id);
    const project = s.projects.get(a.projectId);
    const file = String(Q(req).path ?? '');
    const version = Q(req).version === 'base' ? 'base' : 'current';
    if (version === 'base') return { path: file, version, content: await s.core.git.fileAt(project.repoPath, 'main', file) };
    const dir = a.workspacePath && fs.existsSync(a.workspacePath) ? a.workspacePath : project.repoPath;
    const abs = resolveInside(dir, file);
    if (!fs.existsSync(abs)) return { path: file, version, content: null };
    const st = fs.statSync(abs);
    if (st.size > 2 * 1024 * 1024) throw new HttpError(413, 'File too large to display');
    return { path: file, version, content: fs.readFileSync(abs, 'utf8') };
  });
  app.get('/api/agents/:id/diff', async (req) => {
    const a = s.agents.get(P(req).id);
    if (!a.branch) throw new HttpError(400, 'Agent has no branch');
    const project = s.projects.get(a.projectId);
    const file = String(Q(req).path ?? '');
    resolveInside(project.repoPath, file);
    return { path: file, diff: await s.core.git.fileDiff(project.repoPath, a.branch, file, { worktree: a.workspacePath ?? undefined }) };
  });
  app.post('/api/agents/:id/revert', async (req) => {
    const a = s.agents.get(P(req).id);
    if (!a.workspacePath) throw new HttpError(400, 'Agent has no worktree');
    if (s.runner.isRunning(a.id)) throw new HttpError(409, 'Pause or stop the agent before reverting its files');
    const { path: file } = parse(z.object({ path: z.string().min(1) }), req.body);
    resolveInside(a.workspacePath, file);
    const c = await s.core.git.revertFile(a.workspacePath, file, a.name);
    if (c) s.core.bus.emit({ type: 'git.commit', projectId: a.projectId, agentId: a.id, branch: a.branch!, commit: { ...c, branch: a.branch! } });
    return { ok: true, commit: c };
  });

  // ───────── Tasks ─────────
  app.post('/api/projects/:id/tasks', async (req) => {
    const b = parse(
      z.object({
        title: z.string().min(1).max(200),
        description: z.string().max(20000).optional(),
        priority: z.number().int().min(0).max(10).optional(),
        roleHint: z.string().nullable().optional(),
        assignedAgentId: z.string().nullable().optional(),
        dependsOn: z.array(z.string()).max(100).optional(),
        requiresApproval: z.boolean().optional(),
        script: z.array(scriptStep).max(200).nullable().optional(),
      }),
      req.body,
    );
    const project = s.projects.get(P(req).id);
    return s.tasks.create(project.id, b, { maxAttempts: project.settings.maxTaskAttempts });
  });
  app.patch('/api/tasks/:id', async (req) =>
    s.tasks.update(P(req).id, parse(z.object({ title: z.string().min(1).max(200), description: z.string().max(20000), priority: z.number().int().min(0).max(10), requiresApproval: z.boolean() }).partial(), req.body)),
  );
  app.delete('/api/tasks/:id', async (req) => {
    const t = s.tasks.get(P(req).id);
    if (['working', 'testing'].includes(t.status)) throw new HttpError(409, 'Cancel the task first');
    s.tasks.delete(t.id);
    return { ok: true };
  });
  app.post('/api/tasks/:id/cancel', async (req) => s.orchestrator.cancelTask(P(req).id));
  app.post('/api/tasks/:id/retry', async (req) => s.orchestrator.retryTask(P(req).id));
  app.post('/api/tasks/:id/reassign', async (req) => s.orchestrator.reassignTask(P(req).id, parse(z.object({ agentId: z.string().nullable() }), req.body).agentId));
  app.post('/api/tasks/:id/request-changes', async (req) => s.orchestrator.requestChanges(P(req).id, parse(z.object({ feedback: z.string().min(1).max(5000) }), req.body).feedback));
  app.post('/api/tasks/:id/deps', async (req) => s.tasks.addDependency(P(req).id, parse(z.object({ dependsOn: z.string() }), req.body).dependsOn));
  app.delete('/api/tasks/:id/deps/:dep', async (req) => s.tasks.removeDependency(P(req).id, P(req).dep));
  app.get('/api/tasks/:id/logs', async (req) => s.core.db.all('SELECT * FROM logs WHERE task_id = ? ORDER BY id DESC LIMIT 2000', P(req).id).reverse());

  // ───────── Messages ─────────
  app.get('/api/projects/:id/messages', async (req) => s.messages.list(P(req).id, Math.min(Number(Q(req).limit ?? 300), 2000)));
  app.post('/api/projects/:id/messages', async (req) => {
    const b = parse(z.object({ body: z.string().min(1).max(8000), toAgentId: z.string().nullable().optional(), teamId: z.string().nullable().optional() }), req.body);
    const kind = b.toAgentId ? 'user' : b.teamId ? 'team' : 'broadcast';
    return s.messages.send(P(req).id, { kind, toAgentId: b.toAgentId ?? null, teamId: b.teamId ?? null, body: b.body, meta: { fromName: 'You' } });
  });

  // ───────── Git ─────────
  app.get('/api/projects/:id/branches', async (req): Promise<BranchInfo[]> => {
    const project = s.projects.get(P(req).id);
    const agents = s.agents.list(project.id);
    const merges = s.merges.list(project.id);
    const branches = await s.core.git.listBranches(project.repoPath);
    return Promise.all(
      branches.map(async (b) => {
        const agent = agents.find((a) => a.branch === b.name);
        const [ab, merged, last] = await Promise.all([
          b.name === 'main' ? { ahead: 0, behind: 0 } : s.core.git.aheadBehind(project.repoPath, b.name),
          b.name === 'main' ? true : s.core.git.isMerged(project.repoPath, b.name),
          s.core.git.log(project.repoPath, b.name, 1),
        ]);
        return { name: b.name, head: b.head, agentId: agent?.id ?? null, ahead: ab.ahead, behind: ab.behind, merged: merged && ab.ahead === 0, lastCommit: last[0] ?? null, mergeStatus: merges.find((m) => m.branch === b.name)?.status ?? null };
      }),
    );
  });
  app.get('/api/projects/:id/commits', async (req) => {
    const project = s.projects.get(P(req).id);
    const branch = String(Q(req).branch ?? 'main');
    if (!/^[\w./-]+$/.test(branch)) throw new HttpError(400, 'Invalid branch');
    return s.core.git.log(project.repoPath, branch, Math.min(Number(Q(req).limit ?? 100), 500));
  });

  // ───────── Merge queue & approvals ─────────
  app.get('/api/projects/:id/merges', async (req) => s.merges.list(P(req).id));
  app.post('/api/merges/:id/approve', async (req) => s.merges.decide(P(req).id, true));
  app.post('/api/merges/:id/reject', async (req) => s.merges.decide(P(req).id, false));
  app.post('/api/merges/:id/retry', async (req) => {
    const mr = s.merges.retry(P(req).id);
    s.merges.pump(mr.projectId);
    return mr;
  });
  app.get('/api/projects/:id/approvals', async (req) => s.approvals.list(P(req).id));
  app.post('/api/approvals/:id/approve', async (req) => s.approvals.resolve(P(req).id, true, 'approved by user'));
  app.post('/api/approvals/:id/deny', async (req) => s.approvals.resolve(P(req).id, false, 'denied by user'));

  app.get('/api/meta/statuses', async () => ({ agent: AGENT_STATUSES }));
}

const startedAt = Date.now();

function normalize(a: { ok: boolean; reason?: string }) {
  return { available: a.ok, reason: a.reason };
}
