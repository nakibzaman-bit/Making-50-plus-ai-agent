import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { startApp, type App } from '../src/server/app.js';
import type { ServerEvent } from '../src/shared/events.js';
import { tmpDir, waitFor } from './helpers.js';

let app: App;
let base: string;
const api = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
  const res = await fetch(`${base}${path}`, { method, headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json().catch(() => null) };
};

beforeAll(async () => {
  process.env.ANTHROPIC_API_KEY = '';
  app = await startApp({ config: { dataDir: tmpDir(), tickMs: 80, anthropicApiKey: 'sk-ant-api-test-secret-000' }, llmPlanner: null, port: 0, seed: false, serveStatic: false });
  base = app.url;
});
afterAll(() => app.close());

describe('REST API + WebSocket', () => {
  it('reports system info without leaking secrets', async () => {
    const r = await api('GET', '/api/system');
    expect(r.status).toBe(200);
    expect(r.body.llmConfigured).toBe(true);
    expect(JSON.stringify(r.body)).not.toContain('sk-ant-api-test-secret');
    expect(r.body.runtimes.map((x: { kind: string }) => x.kind)).toEqual(['claude', 'scripted']);
  });

  it('streams live events over WebSocket for the subscribed project', async () => {
    const project = (await api('POST', '/api/projects', { name: 'WS Project', settings: { defaultRuntime: 'scripted', testCommand: '' } })).body;
    const ws = new WebSocket(base.replace('http', 'ws') + '/ws');
    const events: ServerEvent[] = [];
    ws.on('message', (d) => events.push(JSON.parse(String(d))));
    await new Promise((r) => ws.on('open', r));
    ws.send(JSON.stringify({ type: 'subscribe', projectId: project.id }));
    await new Promise((r) => setTimeout(r, 100));

    const agent = (await api('POST', `/api/projects/${project.id}/agents`, { roleId: 'backend', name: 'API Agent' })).body;
    expect(agent.branch).toMatch(/^agent\/api-agent-/);
    const task = (await api('POST', `/api/projects/${project.id}/tasks`, {
      title: 'Write hello',
      assignedAgentId: agent.id,
      script: [{ type: 'write', path: 'hello.txt', content: 'hi' }, { type: 'run', command: 'node -e "console.log(42)"' }, { type: 'commit', message: 'feat: hello' }],
    })).body;
    await api('POST', `/api/projects/${project.id}/run`);
    await waitFor(() => events.some((e) => e.type === 'git.branch' && e.action === 'merged'), { timeout: 30000, message: 'merged event' });
    const types = new Set(events.map((e) => e.type));
    for (const t of ['agent.upserted', 'task.upserted', 'log.batch', 'git.commit', 'merge.upserted', 'message.created', 'metrics.tick']) expect(types.has(t as ServerEvent['type']), t).toBe(true);
    const logLines = events.flatMap((e) => (e.type === 'log.batch' ? e.lines.map((l) => l.line) : []));
    expect(logLines).toContain('42');
    await waitFor(async () => (await api('GET', `/api/projects/${project.id}`)).body.status === 'completed', { message: 'completed' });
    expect((await api('GET', `/api/projects/${project.id}/snapshot`)).body.tasks.find((t: { id: string }) => t.id === task.id).status).toBe('completed');
    ws.close();

    // git endpoints reflect real repository state
    const branches = (await api('GET', `/api/projects/${project.id}/branches`)).body;
    expect(branches.find((b: { name: string }) => b.name === agent.branch).merged).toBe(true);
    const commits = (await api('GET', `/api/projects/${project.id}/commits?branch=main`)).body;
    expect(commits[0].message).toMatch(/^merge: agent\/api-agent/);
    const file = (await api('GET', `/api/agents/${agent.id}/file?path=hello.txt`)).body;
    expect(file.content).toBe('hi');
  });

  it('rejects path traversal, cross-origin writes, bad input and cycles', async () => {
    const project = (await api('POST', '/api/projects', { name: 'Guarded' })).body;
    const agent = (await api('POST', `/api/projects/${project.id}/agents`, { roleId: 'frontend' })).body;
    expect((await api('GET', `/api/agents/${agent.id}/file?path=../../../../etc/passwd`)).status).toBe(400);
    expect((await api('POST', `/api/projects/${project.id}/agents`, { roleId: 'backend' }, { origin: 'http://evil.example' })).status).toBe(403);
    expect((await api('POST', `/api/projects/${project.id}/tasks`, { title: '' })).status).toBe(400);
    expect((await api('PATCH', `/api/projects/${project.id}/settings`, { maxAgents: 0 })).status).toBe(400);
    const a = (await api('POST', `/api/projects/${project.id}/tasks`, { title: 'A' })).body;
    const b = (await api('POST', `/api/projects/${project.id}/tasks`, { title: 'B', dependsOn: [a.id] })).body;
    const cyc = await api('POST', `/api/tasks/${a.id}/deps`, { dependsOn: b.id });
    expect(cyc.status).toBe(400);
    expect(cyc.body.error).toMatch(/cycle/);
    expect((await api('GET', '/api/agents/agt_nope')).status).toBe(404);
  });

  it('refuses cross-origin WebSocket connections', async () => {
    const ws = new WebSocket(base.replace('http', 'ws') + '/ws', { headers: { origin: 'http://evil.example' } });
    const result = await new Promise<string>((resolve) => {
      ws.on('open', () => resolve('open'));
      ws.on('error', () => resolve('rejected'));
    });
    expect(result).toBe('rejected');
  });

  it('creates custom roles and supports search', async () => {
    const role = (await api('POST', '/api/roles', { name: 'Shader Wizard', systemPrompt: 'You write shaders.', tools: ['read_file', 'write_file'], permissions: ['fs.read', 'fs.write'] })).body;
    expect(role.id).toBe('custom-shader-wizard');
    expect((await api('GET', '/api/roles')).body.some((r: { id: string }) => r.id === role.id)).toBe(true);
    const project = (await api('POST', '/api/projects', { name: 'Searchable' })).body;
    await api('POST', `/api/projects/${project.id}/agents`, { roleId: role.id, name: 'Shader Wizard' });
    const results = (await api('GET', `/api/projects/${project.id}/search?q=shader`)).body;
    expect(results.some((r: { type: string }) => r.type === 'agent')).toBe(true);
    expect(results.some((r: { type: string }) => r.type === 'branch')).toBe(true);
  });
});
