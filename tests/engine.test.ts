import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import type Anthropic from '@anthropic-ai/sdk';
import { createServices, type Services } from '../src/server/services.js';
import type { MessagesClient } from '../src/server/agents/runtimes/claudeRuntime.js';
import { HeuristicPlanner, sanitizePlan } from '../src/server/orchestrator/planner.js';
import { parseTestOutput } from '../src/server/tasks/testParser.js';
import { BUILTIN_ROLES } from '../src/shared/roles.js';
import { tmpDir, waitFor } from './helpers.js';

type Msg = Anthropic.Beta.Messages.BetaMessage;

/** Scripted fake of the Anthropic client: returns queued responses, records requests. */
class FakeClient implements MessagesClient {
  requests: Anthropic.Beta.Messages.MessageCreateParamsNonStreaming[] = [];
  constructor(private script: ((req: Anthropic.Beta.Messages.MessageCreateParamsNonStreaming) => Partial<Msg>)[]) {}
  beta = {
    messages: {
      create: async (params: Anthropic.Beta.Messages.MessageCreateParamsNonStreaming): Promise<Msg> => {
        this.requests.push(structuredClone(params));
        const step = this.script.shift();
        if (!step) throw new Error('fake client exhausted');
        const partial = step(params);
        return {
          id: `msg_${this.requests.length}`,
          type: 'message',
          role: 'assistant',
          model: params.model,
          content: [],
          stop_reason: 'end_turn',
          stop_sequence: null,
          usage: { input_tokens: 1000, output_tokens: 200 },
          ...partial,
        } as Msg;
      },
    },
  };
}

const toolUse = (id: string, name: string, input: unknown) => ({ type: 'tool_use', id, name, input }) as never;

function make(client?: MessagesClient, extra: Parameters<typeof createServices>[0] = {}): Services {
  return createServices({ config: { dataDir: tmpDir(), tickMs: 60, anthropicApiKey: null }, llmPlanner: null, claudeClient: client, ...extra });
}

describe('tasks & dependencies', () => {
  let s: Services;
  let pid: string;
  beforeAll(async () => {
    s = make();
    pid = (await s.projects.create({ name: 'deps', settings: { defaultRuntime: 'scripted' } })).id;
  });
  afterAll(() => s.close());

  it('creates tasks with dependencies and refuses cycles', () => {
    const a = s.tasks.create(pid, { title: 'Backend API' }, { maxAttempts: 1 });
    const b = s.tasks.create(pid, { title: 'Authentication', dependsOn: [a.id] }, { maxAttempts: 1 });
    const c = s.tasks.create(pid, { title: 'Frontend integration', dependsOn: [b.id] }, { maxAttempts: 1 });
    expect(s.tasks.get(c.id).dependsOn).toEqual([b.id]);
    expect(() => s.tasks.addDependency(a.id, c.id)).toThrow(/cycle/);
    expect(() => s.tasks.addDependency(a.id, a.id)).toThrow(/cycle/);
    const byId = new Map(s.tasks.list(pid).map((t) => [t.id, t]));
    expect(s.tasks.readiness(byId.get(a.id)!, byId)).toBe('ready');
    expect(s.tasks.readiness(byId.get(c.id)!, byId)).toBe('waiting');
    s.tasks.setStatus(a.id, 'failed');
    const byId2 = new Map(s.tasks.list(pid).map((t) => [t.id, t]));
    expect(s.tasks.readiness(byId2.get(b.id)!, byId2)).toBe('blocked');
  });

  it('rejects unknown dependencies', () => {
    expect(() => s.tasks.create(pid, { title: 'x', dependsOn: ['tsk_nope'] }, { maxAttempts: 1 })).toThrow(/Unknown dependency/);
  });
});

describe('agents, messages, approvals, limits', () => {
  let s: Services;
  let pid: string;
  beforeAll(async () => {
    s = make();
    pid = (await s.projects.create({ name: 'agents', settings: { defaultRuntime: 'scripted', maxAgents: 4 } })).id;
  });
  afterAll(() => s.close());

  it('spawns agents with isolated worktrees and deletes them cleanly', async () => {
    const a = await s.orchestrator.spawn(pid, { roleId: 'frontend', name: 'Frontend Architect' });
    expect(a.branch).toMatch(/^agent\/frontend-architect-/);
    expect(fs.existsSync(path.join(a.workspacePath!, '.git'))).toBe(true);
    const branches = (await s.core.git.listBranches(s.projects.get(pid).repoPath)).map((b) => b.name);
    expect(branches).toContain(a.branch);
    await s.orchestrator.removeAgent(a.id, true);
    expect(s.agents.find(a.id)).toBeUndefined();
    expect(fs.existsSync(a.workspacePath!)).toBe(false);
    expect(await s.core.git.branchExists(s.projects.get(pid).repoPath, a.branch!)).toBe(false);
  });

  it('enforces MAX AGENTS', async () => {
    // orchestrator + 3 = 4
    for (let i = 0; i < 3; i++) await s.orchestrator.spawn(pid, { roleId: 'backend', name: `B${i}` });
    await expect(s.orchestrator.spawn(pid, { roleId: 'backend' })).rejects.toThrow(/Agent limit/);
  });

  it('routes direct, team and broadcast messages to inboxes', async () => {
    const [b0, b1] = s.agents.list(pid).filter((a) => a.roleId === 'backend');
    const team = s.teams.create(pid, { name: 'Core' });
    s.agents.update(b0.id, { teamId: team.id });
    s.agents.update(b1.id, { teamId: team.id });
    const since = Date.now() - 1;
    s.messages.send(pid, { kind: 'direct', fromAgentId: b0.id, toAgentId: b1.id, body: 'API endpoint /users is missing.' });
    s.messages.send(pid, { kind: 'team', fromAgentId: b0.id, teamId: team.id, body: 'team note' });
    s.messages.send(pid, { kind: 'broadcast', body: 'Integration tests started.' });
    const inbox = s.messages.inbox(pid, b1.id, team.id, since).map((m) => m.body);
    expect(inbox).toEqual(['API endpoint /users is missing.', 'team note', 'Integration tests started.']);
    // sender does not receive its own messages
    expect(s.messages.inbox(pid, b0.id, team.id, since).map((m) => m.body)).toEqual(['Integration tests started.']);
  });

  it('approvals block until a human decides', async () => {
    const p = s.approvals.request(pid, null, 'command', 'rm -r build');
    const pending = s.approvals.pending(pid);
    expect(pending).toHaveLength(1);
    s.approvals.resolve(pending[0].id, false);
    await expect(p).resolves.toBe(false);
    expect(s.approvals.pending(pid)).toHaveLength(0);
  });
});

describe('scheduler', () => {
  it('respects MAX CONCURRENT TASKS and queues the rest', async () => {
    const s = make();
    const pid = (await s.projects.create({ name: 'conc', settings: { defaultRuntime: 'scripted', maxConcurrentTasks: 2, testCommand: '' } })).id;
    for (let i = 0; i < 4; i++) {
      const a = await s.orchestrator.spawn(pid, { roleId: 'backend', name: `W${i}` });
      s.tasks.create(pid, { title: `job ${i}`, assignedAgentId: a.id, script: [{ type: 'run', command: 'node -e "setTimeout(()=>{},700)"' }] }, { maxAttempts: 1 });
    }
    let maxSeen = 0;
    s.core.bus.on(() => (maxSeen = Math.max(maxSeen, s.runner.activeCount(pid))));
    s.orchestrator.start();
    s.orchestrator.run(pid);
    await waitFor(() => s.agents.list(pid).some((a) => a.status === 'queued' && /free slot/.test(a.statusReason ?? '')), { message: 'queued agent' });
    await waitFor(() => s.projects.get(pid).status === 'completed', { timeout: 30000, message: 'done' });
    expect(maxSeen).toBe(2);
    await s.close();
  });

  it('dynamically spawns an agent for an unstaffed role', async () => {
    const s = make();
    const pid = (await s.projects.create({ name: 'dyn', settings: { defaultRuntime: 'scripted', testCommand: '' } })).id;
    s.tasks.create(pid, { title: 'Physics step', roleHint: 'physics', script: [{ type: 'write', path: 'physics.js', content: 'export const g = 9.81;\n' }, { type: 'commit', message: 'feat: gravity' }] }, { maxAttempts: 1 });
    s.orchestrator.start();
    s.orchestrator.run(pid);
    await waitFor(() => s.projects.get(pid).status === 'completed', { timeout: 30000, message: 'done' });
    const physics = s.agents.list(pid).filter((a) => a.roleId === 'physics');
    expect(physics).toHaveLength(1);
    expect(fs.readFileSync(path.join(s.projects.get(pid).repoPath, 'physics.js'), 'utf8')).toContain('9.81');
    await s.close();
  });

  it('pauses and stops an agent mid-task, killing its processes', async () => {
    const s = make();
    const pid = (await s.projects.create({ name: 'stop', settings: { defaultRuntime: 'scripted', testCommand: '' } })).id;
    const a = await s.orchestrator.spawn(pid, { roleId: 'backend', name: 'Sleeper' });
    const t = s.tasks.create(pid, { title: 'long', assignedAgentId: a.id, script: [{ type: 'run', command: 'node -e "setInterval(()=>{},1000)"' }] }, { maxAttempts: 1 });
    s.orchestrator.start();
    s.orchestrator.run(pid);
    await waitFor(() => s.core.pm.list().some((p) => p.agentId === a.id), { message: 'process started' });
    s.orchestrator.stopAgent(a.id);
    await waitFor(() => !s.runner.isRunning(a.id), { message: 'runner stopped' });
    expect(s.core.pm.list().some((p) => p.agentId === a.id)).toBe(false);
    expect(s.agents.get(a.id).status).toBe('stopped');
    // The orphaned task is released from the stopped agent (the scheduler may re-staff it).
    expect(s.tasks.get(t.id).assignedAgentId).not.toBe(a.id);
    expect(['queued', 'assigned', 'working'].includes(s.tasks.get(t.id).status)).toBe(true);
    await s.close();
  });
});

describe('merge queue', () => {
  it('detects conflicts and does not merge', async () => {
    const s = make();
    const pid = (await s.projects.create({ name: 'conflict', settings: { defaultRuntime: 'scripted', testCommand: '', autoDebug: false, maxTaskAttempts: 1 }, files: { 'shared.txt': 'base\n' } })).id;
    const a = await s.orchestrator.spawn(pid, { roleId: 'backend', name: 'One' });
    const b = await s.orchestrator.spawn(pid, { roleId: 'backend', name: 'Two' });
    for (const [agent, text] of [[a, 'from one'], [b, 'from two']] as const)
      s.tasks.create(pid, { title: `edit ${agent.name}`, assignedAgentId: agent.id, script: [{ type: 'write', path: 'shared.txt', content: `${text}\n` }, { type: 'commit', message: `edit by ${agent.name}` }] }, { maxAttempts: 1 });
    s.orchestrator.start();
    s.orchestrator.run(pid);
    await waitFor(() => ['completed', 'failed'].includes(s.projects.get(pid).status), { timeout: 30000, message: 'done' });
    const merges = s.merges.list(pid);
    expect(merges.filter((m) => m.status === 'merged')).toHaveLength(1);
    const conflicted = merges.find((m) => m.status === 'conflict')!;
    expect(conflicted.conflictFiles).toEqual(['shared.txt']);
    expect(conflicted.checks.conflicts.status).toBe('failed');
    expect(s.projects.get(pid).status).toBe('failed');
    await s.close();
  });

  it('holds merges for approval and honours rejection', async () => {
    const s = make();
    const pid = (await s.projects.create({ name: 'approve', settings: { defaultRuntime: 'scripted', testCommand: '', requireApproval: true } })).id;
    const a = await s.orchestrator.spawn(pid, { roleId: 'backend', name: 'Gated' });
    const t = s.tasks.create(pid, { title: 'gated change', assignedAgentId: a.id, script: [{ type: 'write', path: 'g.txt', content: 'x' }, { type: 'commit', message: 'gated' }] }, { maxAttempts: 1 });
    s.orchestrator.start();
    s.orchestrator.run(pid);
    const mr = await waitFor(() => s.merges.list(pid).find((m) => m.status === 'awaiting_approval'), { message: 'awaiting approval' });
    expect(fs.existsSync(path.join(s.projects.get(pid).repoPath, 'g.txt'))).toBe(false);
    s.merges.decide(mr.id, false);
    await waitFor(() => s.merges.get(mr.id).status === 'rejected', { message: 'rejected' });
    await waitFor(() => s.tasks.get(t.id).status === 'failed', { message: 'task failed' });
    expect(s.agents.list(pid).some((x) => x.roleId === 'debugger')).toBe(false); // rejections are not auto-debugged
    expect(fs.existsSync(path.join(s.projects.get(pid).repoPath, 'g.txt'))).toBe(false);
    await s.close();
  });
});

describe('Claude runtime (tool loop with injected client)', () => {
  it('writes files, runs commands, messages teammates, commits and completes', async () => {
    const client = new FakeClient([
      () => ({ stop_reason: 'tool_use', content: [{ type: 'text', text: 'Creating the module.' } as never, toolUse('t1', 'write_file', { path: 'src/sum.js', content: 'export const sum = (a, b) => a + b;\n' }), toolUse('t2', 'write_file', { path: 'sum.test.js', content: "import {test} from 'node:test';import assert from 'node:assert';import {sum} from './src/sum.js';test('sum',()=>assert.equal(sum(2,3),5));\n" })] }),
      () => ({ stop_reason: 'tool_use', content: [toolUse('t3', 'run_command', { command: 'node --test sum.test.js' }), toolUse('t4', 'run_command', { command: 'cat /etc/passwd' })] }),
      (req) => {
        const last = req.messages[req.messages.length - 1].content as { type: string; content?: string; is_error?: boolean }[];
        if (!String(last[0].content).includes('exit code 0')) throw new Error('expected passing test result');
        if (!last[1].is_error || !String(last[1].content).includes('escapes')) throw new Error('expected policy denial');
        return { stop_reason: 'tool_use', content: [toolUse('t5', 'send_message', { to_role: 'frontend', body: 'sum() is ready' }), toolUse('t6', 'git_commit', { message: 'feat: sum' })] };
      },
      () => ({ stop_reason: 'tool_use', content: [toolUse('t7', 'complete_task', { success: true, summary: 'Implemented sum with a test.' })] }),
    ]);
    const s = make(client);
    const pid = (await s.projects.create({ name: 'llm', settings: { defaultRuntime: 'claude', testCommand: 'node --test' } })).id;
    const fe = await s.orchestrator.spawn(pid, { roleId: 'frontend', name: 'FE' });
    const be = await s.orchestrator.spawn(pid, { roleId: 'backend', name: 'BE' });
    s.tasks.create(pid, { title: 'Implement sum', assignedAgentId: be.id }, { maxAttempts: 1 });
    s.orchestrator.start();
    s.orchestrator.run(pid);
    await waitFor(() => s.projects.get(pid).status !== 'running', { timeout: 30000, message: 'done' });
    expect(s.projects.get(pid).status).toBe('completed');
    const agent = s.agents.get(be.id);
    expect(agent.tokensIn).toBe(4000);
    expect(agent.tokensOut).toBe(800);
    expect(agent.costUsd).toBeGreaterThan(0);
    expect(agent.commits).toBe(1);
    expect(fs.existsSync(path.join(s.projects.get(pid).repoPath, 'src/sum.js'))).toBe(true);
    const req0 = client.requests[0];
    expect(req0.model).toBe('claude-opus-5-5');
    expect(req0.tools!.map((t) => (t as { name: string }).name)).toContain('run_command');
    expect(req0.tools!.map((t) => (t as { name: string }).name)).not.toContain('spawn_agent'); // backend lacks agents.spawn
    expect(JSON.stringify(req0)).not.toContain('sk-ant');
    expect(s.messages.forAgent(fe.id).some((m) => m.body === 'sum() is ready')).toBe(true);
    await s.close();
  });

  it('stops on refusal and enforces the token budget', async () => {
    const refusal = new FakeClient([() => ({ stop_reason: 'refusal', stop_details: { type: 'refusal', category: 'cyber', explanation: null } as never })]);
    const s = make(refusal);
    const pid = (await s.projects.create({ name: 'refuse', settings: { defaultRuntime: 'claude', testCommand: '', autoDebug: false, maxTaskAttempts: 1 } })).id;
    const a = await s.orchestrator.spawn(pid, { roleId: 'backend', name: 'R' });
    const t = s.tasks.create(pid, { title: 'x', assignedAgentId: a.id }, { maxAttempts: 1 });
    s.orchestrator.start();
    s.orchestrator.run(pid);
    await waitFor(() => s.tasks.get(t.id).status === 'failed', { message: 'refusal fail' });
    expect(s.tasks.get(t.id).error).toMatch(/declined/);

    const looping = new FakeClient(Array.from({ length: 5 }, (_, i) => () => ({ stop_reason: 'tool_use', usage: { input_tokens: 60_000, output_tokens: 1000 }, content: [toolUse(`l${i}`, 'list_files', {})] }) as Partial<Msg>));
    const s2 = make(looping);
    const pid2 = (await s2.projects.create({ name: 'budget', settings: { defaultRuntime: 'claude', testCommand: '', autoDebug: false, maxTaskAttempts: 1 } })).id;
    const b = await s2.orchestrator.spawn(pid2, { roleId: 'backend', name: 'B' });
    s2.agents.update(b.id, { tokenBudget: 100_000 });
    const t2 = s2.tasks.create(pid2, { title: 'loop', assignedAgentId: b.id }, { maxAttempts: 1 });
    s2.orchestrator.start();
    s2.orchestrator.run(pid2);
    await waitFor(() => s2.tasks.get(t2.id).status === 'failed', { message: 'budget fail' });
    expect(s2.tasks.get(t2.id).error).toMatch(/budget/);
    expect(looping.requests.length).toBe(2);
    await s.close();
    await s2.close();
  });

  it('is reported unavailable without an API key and tasks wait instead of faking work', async () => {
    const s = make();
    const pid = (await s.projects.create({ name: 'nokey', settings: { defaultRuntime: 'claude', testCommand: '' } })).id;
    const a = await s.orchestrator.spawn(pid, { roleId: 'backend', name: 'NoKey' });
    const t = s.tasks.create(pid, { title: 'needs llm', assignedAgentId: a.id }, { maxAttempts: 1 });
    s.orchestrator.start();
    s.orchestrator.run(pid);
    await waitFor(() => /ANTHROPIC_API_KEY/.test(s.agents.get(a.id).statusReason ?? ''), { message: 'unavailable reason' });
    expect(s.tasks.get(t.id).status).toBe('queued');
    expect(s.agents.get(a.id).status).toBe('queued');
    await s.close();
  });
});

describe('orchestrator planning', () => {
  it('turns an objective into teams, agents and a dependency DAG (heuristic planner)', async () => {
    const s = make();
    const pid = (await s.projects.create({ name: 'football', settings: { defaultRuntime: 'scripted' } })).id;
    const plan = await s.orchestrator.submitObjective(pid, 'Build a complete football game', { autoRun: false });
    expect(plan.planner).toBe('heuristic');
    const agents = s.agents.list(pid);
    expect(agents.length).toBeGreaterThanOrEqual(21); // 20 specialists + orchestrator
    for (const n of ['Game Director', 'Goalkeeper AI Agent', 'Commentary Agent', 'Build Agent']) expect(agents.map((a) => a.name)).toContain(n);
    const tasks = s.tasks.list(pid);
    const build = tasks.find((t) => t.title === 'Release build')!;
    expect(build.dependsOn.length).toBe(2);
    expect(s.teams.list(pid).length).toBe(6);
    // hierarchy: members report to their team lead
    const keeper = agents.find((a) => a.name === 'Goalkeeper AI Agent')!;
    expect(s.agents.get(keeper.parentId!).name).toBe('AI Opponent Agent');
    await s.close();
  });

  it('sanitizePlan drops dangling references and breaks cycles', () => {
    const plan = sanitizePlan(
      {
        summary: 's',
        teams: [{ name: 'T' }],
        agents: [{ key: 'a', roleId: 'not-a-role', name: 'A', team: 'T' }],
        tasks: [
          { key: '1', title: 'one', description: '', agent: 'a', dependsOn: ['2', 'ghost'], priority: 99 },
          { key: '2', title: 'two', description: '', agent: 'a', dependsOn: ['1'], priority: -4 },
          { key: '3', title: 'orphan', description: '', agent: 'nobody', dependsOn: [], priority: 5 },
        ],
      },
      BUILTIN_ROLES,
      'llm',
    );
    expect(plan.agents[0].roleId).toBe('backend');
    expect(plan.tasks.map((t) => t.key)).toEqual(['1', '2']);
    const deps = Object.fromEntries(plan.tasks.map((t) => [t.key, t.dependsOn]));
    expect(deps['1'].includes('2') && deps['2'].includes('1')).toBe(false);
    expect(plan.tasks.map((t) => t.priority)).toEqual([10, 0]);
  });

  it('heuristic planner covers the e-commerce example', async () => {
    const plan = await new HeuristicPlanner().plan('Build an e-commerce website', BUILTIN_ROLES);
    expect(plan.agents.map((a) => a.name)).toEqual(expect.arrayContaining(['UI Agent', 'Cart Agent', 'Checkout Agent', 'Payment Agent', 'Security Agent', 'DevOps Agent', 'Documentation Agent']));
  });
});

describe('test output parser', () => {
  it.each([
    ['# pass 12\n# fail 1', { passed: 12, failed: 1 }],
    [' Tests  31 passed (31)', { passed: 31, failed: 0 }],
    [' Tests  2 failed | 29 passed (31)', { passed: 29, failed: 2 }],
    ['Tests:       1 failed, 3 passed, 4 total', { passed: 3, failed: 1 }],
    ['  5 passing (20ms)\n  1 failing', { passed: 5, failed: 1 }],
    ['===== 3 passed, 1 failed in 0.12s =====', { passed: 3, failed: 1 }],
    ['test result: ok. 7 passed; 0 failed; 0 ignored', { passed: 7, failed: 0 }],
  ])('parses %j', (out, expected) => expect(parseTestOutput(out)).toEqual(expected));
  it('returns null for unknown output', () => expect(parseTestOutput('hello')).toBeNull());
});
