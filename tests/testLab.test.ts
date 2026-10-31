import { afterAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createServices } from '../src/server/services.js';
import { seedTestLab } from '../src/server/projects/testLab.js';
import { tmpDir, waitFor } from './helpers.js';

const s = createServices({ config: { dataDir: tmpDir(), tickMs: 100, anthropicApiKey: null }, llmPlanner: null });
afterAll(() => s.close());

describe('NEXUS TEST LAB (full real run)', () => {
  it('runs 20+ agents to completion with retries, a debugger, approvals and merges', async () => {
    const pid = await seedTestLab(s);
    expect(s.agents.list(pid).length).toBeGreaterThanOrEqual(22);
    const teams = s.teams.list(pid);
    expect(teams.length).toBe(5);
    // every non-orchestrator agent has its own real worktree on its own branch
    for (const a of s.agents.list(pid).filter((a) => a.roleId !== 'orchestrator')) {
      expect(fs.existsSync(path.join(a.workspacePath!, '.git'))).toBe(true);
      expect(a.branch).toMatch(/^agent\//);
    }

    s.orchestrator.start();
    s.orchestrator.run(pid);

    // The auth merge is gated on human approval: approve it when it shows up.
    const approval = await waitFor(() => s.approvals.pending(pid).find((a) => a.kind === 'merge'), { timeout: 150_000, message: 'merge approval' });
    s.approvals.resolve(approval.id, true, 'approved in test');

    await waitFor(() => ['completed', 'failed'].includes(s.projects.get(pid).status), { timeout: 170_000, interval: 250, message: 'project completion' });
    const project = s.projects.get(pid);
    const tasks = s.tasks.list(pid);
    const failedTasks = tasks.filter((t) => t.status !== 'completed').map((t) => `${t.title}: ${t.status} ${t.error}`);
    expect(failedTasks).toEqual([]);
    expect(project.status).toBe('completed');

    // A real failure happened, was retried, and a debugger agent fixed it.
    const easing = tasks.find((t) => t.title === 'Easing curves')!;
    expect(easing.result).toMatch(/Resolved by Debugger/);
    const debuggers = s.agents.list(pid).filter((a) => a.roleId === 'debugger');
    expect(debuggers).toHaveLength(1);
    const anim = s.agents.list(pid).find((a) => a.name === 'Animation Agent')!;
    expect(anim.retries).toBeGreaterThanOrEqual(1);

    // Everything landed on main and the merged toolkit's test suite passes for real.
    const repo = project.repoPath;
    for (const f of ['src/ui/easing.js', 'src/ai/eval.js', 'src/auth/token.js', 'tests/integration.test.js', 'scripts/build.js', 'README.md'])
      expect(fs.existsSync(path.join(repo, f)), f).toBe(true);
    expect(fs.readFileSync(path.join(repo, 'src/ui/easing.js'), 'utf8')).toContain('-1 + (4 - 2 * t) * t');
    const out = execFileSync('node', ['--test'], { cwd: repo, encoding: 'utf8' });
    expect(out).toMatch(/# fail 0/);

    const merged = s.merges.list(pid).filter((m) => m.status === 'merged');
    expect(merged.length).toBeGreaterThanOrEqual(18);
    const msgs = s.messages.list(pid, 1000).map((m) => m.body);
    expect(msgs.some((m) => /Endpoint \/users\/:id implemented\. Commit [0-9a-f]{7}/.test(m))).toBe(true);
    expect(msgs.some((m) => /Objective complete/.test(m))).toBe(true);
    // real logs from real processes
    const logs = s.core.repos.logs.forProject(pid, 5000).map((l) => l.line);
    expect(logs.some((l) => l.includes('# pass'))).toBe(true);
  }, 200_000);
});
