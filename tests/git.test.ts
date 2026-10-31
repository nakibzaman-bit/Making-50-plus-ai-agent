import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { GitService } from '../src/server/git/gitService.js';
import { tmpDir } from './helpers.js';

const git = new GitService();

async function setup() {
  const root = tmpDir();
  const repo = path.join(root, 'repo');
  await git.initRepo(repo, { 'src/a.txt': 'one\ntwo\nthree\n' });
  return { root, repo };
}

describe('GitService', () => {
  it('creates a repository with an initial commit on main', async () => {
    const { repo } = await setup();
    expect(await git.isRepo(repo)).toBe(true);
    const log = await git.log(repo, 'main');
    expect(log).toHaveLength(1);
    expect(log[0].message).toBe('chore: initialise project');
  });

  it('gives each agent an isolated worktree on its own branch', async () => {
    const { root, repo } = await setup();
    const wa = path.join(root, 'wt', 'a');
    const wb = path.join(root, 'wt', 'b');
    await Promise.all([git.ensureWorktree(repo, 'agent/a', wa), git.ensureWorktree(repo, 'agent/b', wb)]);
    fs.writeFileSync(path.join(wa, 'only-a.txt'), 'a');
    await git.commitAll(wa, 'feat: a', 'Agent A');
    // Branch isolation: B's worktree never sees A's file, main is untouched.
    expect(fs.existsSync(path.join(wb, 'only-a.txt'))).toBe(false);
    expect(fs.existsSync(path.join(repo, 'only-a.txt'))).toBe(false);
    expect((await git.branchCommits(repo, 'agent/a')).map((c) => c.message)).toEqual(['feat: a']);
    expect(await git.branchCommits(repo, 'agent/b')).toEqual([]);
    const branches = (await git.listBranches(repo)).map((b) => b.name).sort();
    expect(branches).toEqual(['agent/a', 'agent/b', 'main']);
  });

  it('commits as the agent and reports changes and diffs', async () => {
    const { root, repo } = await setup();
    const wt = path.join(root, 'wt');
    await git.ensureWorktree(repo, 'agent/x', wt);
    fs.writeFileSync(path.join(wt, 'src/a.txt'), 'one\nTWO\nthree\nfour\n');
    fs.writeFileSync(path.join(wt, 'new.txt'), 'hello\n');
    const working = await git.workingChanges(wt);
    expect(working.map((c) => [c.path, c.status]).sort()).toEqual([['new.txt', 'untracked'], ['src/a.txt', 'modified']]);
    const c = await git.commitAll(wt, 'feat: change a', 'Backend Agent');
    expect(c?.author).toBe('Backend Agent');
    expect(await git.commitAll(wt, 'noop', 'Backend Agent')).toBeNull();
    const changes = await git.committedChanges(repo, 'agent/x');
    const a = changes.find((x) => x.path === 'src/a.txt')!;
    expect(a.additions).toBe(2);
    expect(a.deletions).toBe(1);
    const diff = await git.fileDiff(repo, 'agent/x', 'src/a.txt');
    expect(diff).toContain('+TWO');
    expect(diff).toContain('-two');
    expect(await git.fileAt(repo, 'main', 'src/a.txt')).toBe('one\ntwo\nthree\n');
  });

  it('detects conflicts without touching the working tree, then merges clean branches', async () => {
    const { root, repo } = await setup();
    const w1 = path.join(root, 'w1');
    const w2 = path.join(root, 'w2');
    await git.ensureWorktree(repo, 'agent/one', w1);
    await git.ensureWorktree(repo, 'agent/two', w2);
    fs.writeFileSync(path.join(w1, 'src/a.txt'), 'one\nFROM-ONE\nthree\n');
    fs.writeFileSync(path.join(w2, 'src/a.txt'), 'one\nFROM-TWO\nthree\n');
    await git.commitAll(w1, 'one', 'One');
    await git.commitAll(w2, 'two', 'Two');
    expect(await git.checkConflicts(repo, 'agent/one')).toEqual({ clean: true, files: [] });
    const merged = await git.mergeIntoBase(repo, 'agent/one', 'merge one');
    expect(merged).toMatch(/^[0-9a-f]{40}$/);
    expect(await git.isMerged(repo, 'agent/one')).toBe(true);
    const conflict = await git.checkConflicts(repo, 'agent/two');
    expect(conflict.clean).toBe(false);
    expect(conflict.files).toContain('src/a.txt');
    await expect(git.mergeIntoBase(repo, 'agent/two', 'merge two')).rejects.toThrow();
    // main is left clean after the failed merge
    expect((await git.exec(repo, ['status', '--porcelain'])).stdout.trim()).toBe('');
  });

  it('syncs a worktree with the latest main and runs integration trees', async () => {
    const { root, repo } = await setup();
    const w1 = path.join(root, 'w1');
    const w2 = path.join(root, 'w2');
    await git.ensureWorktree(repo, 'agent/api', w1);
    await git.ensureWorktree(repo, 'agent/ui', w2);
    fs.writeFileSync(path.join(w1, 'api.txt'), 'endpoint');
    await git.commitAll(w1, 'feat: api', 'API');
    await git.mergeIntoBase(repo, 'agent/api', 'merge api');
    const sync = await git.syncWithBase(w2, 'UI');
    expect(sync.ok).toBe(true);
    expect(fs.existsSync(path.join(w2, 'api.txt'))).toBe(true);
    fs.writeFileSync(path.join(w2, 'ui.txt'), 'ui');
    await git.commitAll(w2, 'feat: ui', 'UI');
    const files = await git.withIntegrationTree(repo, 'agent/ui', path.join(root, 'int'), async (dir) => fs.readdirSync(dir).sort());
    expect(files).toEqual(expect.arrayContaining(['api.txt', 'ui.txt']));
    expect(fs.existsSync(path.join(root, 'int'))).toBe(false);
  });

  it('reverts a file to its base version', async () => {
    const { root, repo } = await setup();
    const wt = path.join(root, 'wt');
    await git.ensureWorktree(repo, 'agent/r', wt);
    fs.writeFileSync(path.join(wt, 'src/a.txt'), 'broken');
    fs.writeFileSync(path.join(wt, 'added.txt'), 'x');
    await git.commitAll(wt, 'oops', 'R');
    await git.revertFile(wt, 'src/a.txt', 'R');
    await git.revertFile(wt, 'added.txt', 'R');
    expect(fs.readFileSync(path.join(wt, 'src/a.txt'), 'utf8')).toBe('one\ntwo\nthree\n');
    expect(fs.existsSync(path.join(wt, 'added.txt'))).toBe(false);
    expect(await git.committedChanges(repo, 'agent/r')).toEqual([]);
  });

  it('removes worktrees and branches', async () => {
    const { root, repo } = await setup();
    const wt = path.join(root, 'wt');
    await git.ensureWorktree(repo, 'agent/tmp', wt);
    await git.removeWorktree(repo, wt, { deleteBranch: 'agent/tmp' });
    expect(fs.existsSync(wt)).toBe(false);
    expect(await git.branchExists(repo, 'agent/tmp')).toBe(false);
  });
});
