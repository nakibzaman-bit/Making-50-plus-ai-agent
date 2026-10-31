import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { CommitInfo, FileChange } from '../../shared/types.js';

export class GitError extends Error {
  constructor(message: string, public stderr: string, public code: number | null) {
    super(message);
  }
}

interface GitResult {
  stdout: string;
  stderr: string;
  code: number;
}

/** Serialises async work per key (used for ref-mutating ops on a shared repo). */
class KeyedMutex {
  private chains = new Map<string, Promise<unknown>>();
  run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.chains.get(key) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    this.chains.set(key, next.catch(() => undefined));
    return next;
  }
}

const SEP = '\u001f';
const LOG_FORMAT = ['%H', '%h', '%an', '%s', '%ct'].join(SEP);

function parseLog(out: string): CommitInfo[] {
  return out
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      const [hash, shortHash, author, message, ct] = l.split(SEP);
      return { hash, shortHash, author, message, date: Number(ct) * 1000 };
    });
}

/**
 * All git operations NEXUS performs on behalf of the system (not agents). Uses the git
 * CLI with argument arrays (never a shell) and a clean, non-interactive environment.
 */
export class GitService {
  private mutex = new KeyedMutex();
  readonly base = 'main';

  async exec(cwd: string, args: string[], opts: { allowFail?: boolean; env?: NodeJS.ProcessEnv } = {}): Promise<GitResult> {
    return new Promise((resolve, reject) => {
      execFile(
        'git',
        args,
        {
          cwd,
          maxBuffer: 32 * 1024 * 1024,
          env: {
            PATH: process.env.PATH,
            HOME: process.env.HOME,
            LANG: 'C',
            GIT_TERMINAL_PROMPT: '0',
            GIT_CONFIG_NOSYSTEM: '1',
            ...opts.env,
          },
          timeout: 120_000,
        },
        (err, stdout, stderr) => {
          const code = err ? (typeof (err as NodeJS.ErrnoException).code === 'number' ? Number((err as NodeJS.ErrnoException).code) : 1) : 0;
          if (err && !opts.allowFail) {
            reject(new GitError(`git ${args.join(' ')} failed: ${stderr || err.message}`, stderr, code));
            return;
          }
          resolve({ stdout, stderr, code });
        },
      );
    });
  }

  private lock<T>(repo: string, fn: () => Promise<T>) {
    return this.mutex.run(path.resolve(repo), fn);
  }

  async isRepo(dir: string): Promise<boolean> {
    if (!fs.existsSync(dir)) return false;
    const r = await this.exec(dir, ['rev-parse', '--is-inside-work-tree'], { allowFail: true });
    return r.code === 0 && r.stdout.trim() === 'true';
  }

  /** Create a fresh repository with an initial commit on main. */
  async initRepo(repo: string, files: Record<string, string> = {}): Promise<string> {
    fs.mkdirSync(repo, { recursive: true });
    if (await this.isRepo(repo)) return this.head(repo);
    await this.exec(repo, ['init', '-b', this.base]);
    await this.exec(repo, ['config', 'user.name', 'NEXUS Orchestrator']);
    await this.exec(repo, ['config', 'user.email', 'orchestrator@nexus.local']);
    await this.exec(repo, ['config', 'commit.gpgsign', 'false']);
    const initial = { 'README.md': '# Project\n\nManaged by NEXUS AI Workspace.\n', '.gitignore': 'node_modules/\n.nexus-home/\n', ...files };
    for (const [rel, content] of Object.entries(initial)) {
      const abs = path.join(repo, rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, content);
    }
    await this.exec(repo, ['add', '-A']);
    await this.exec(repo, ['commit', '-m', 'chore: initialise project'], { env: this.authorEnv('NEXUS Orchestrator') });
    return this.head(repo);
  }

  authorEnv(name: string): NodeJS.ProcessEnv {
    const email = `${name.toLowerCase().replace(/[^a-z0-9]+/g, '.')}@agents.nexus.local`;
    return { GIT_AUTHOR_NAME: name, GIT_AUTHOR_EMAIL: email, GIT_COMMITTER_NAME: name, GIT_COMMITTER_EMAIL: email };
  }

  async head(cwd: string, ref = 'HEAD'): Promise<string> {
    return (await this.exec(cwd, ['rev-parse', ref])).stdout.trim();
  }

  async branchExists(repo: string, branch: string): Promise<boolean> {
    const r = await this.exec(repo, ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], { allowFail: true });
    return r.code === 0;
  }

  /** Give a branch its own isolated working directory. Idempotent. */
  async ensureWorktree(repo: string, branch: string, worktree: string, from = this.base): Promise<void> {
    await this.lock(repo, async () => {
      if (fs.existsSync(path.join(worktree, '.git'))) return;
      await this.exec(repo, ['worktree', 'prune']);
      fs.mkdirSync(path.dirname(worktree), { recursive: true });
      if (await this.branchExists(repo, branch)) await this.exec(repo, ['worktree', 'add', worktree, branch]);
      else await this.exec(repo, ['worktree', 'add', '-b', branch, worktree, from]);
    });
  }

  async removeWorktree(repo: string, worktree: string, opts: { deleteBranch?: string } = {}): Promise<void> {
    await this.lock(repo, async () => {
      if (fs.existsSync(worktree)) await this.exec(repo, ['worktree', 'remove', '--force', worktree], { allowFail: true });
      await this.exec(repo, ['worktree', 'prune'], { allowFail: true });
      if (opts.deleteBranch && (await this.branchExists(repo, opts.deleteBranch)))
        await this.exec(repo, ['branch', '-D', opts.deleteBranch], { allowFail: true });
    });
  }

  /** Merge the latest base into a worktree's branch ("pull changes"). */
  async syncWithBase(worktree: string, authorName: string, base = this.base): Promise<{ ok: boolean; conflicts: string[]; updated: boolean }> {
    const before = await this.head(worktree);
    const r = await this.exec(worktree, ['merge', '--no-edit', base], { allowFail: true, env: this.authorEnv(authorName) });
    if (r.code !== 0) {
      const conflicts = (await this.exec(worktree, ['diff', '--name-only', '--diff-filter=U'], { allowFail: true })).stdout.split('\n').filter(Boolean);
      await this.exec(worktree, ['merge', '--abort'], { allowFail: true });
      return { ok: false, conflicts, updated: false };
    }
    return { ok: true, conflicts: [], updated: (await this.head(worktree)) !== before };
  }

  /** Merge base into the worktree and LEAVE conflict markers for an agent to resolve. */
  async mergeBaseKeepConflicts(worktree: string, authorName: string, base = this.base): Promise<string[]> {
    const r = await this.exec(worktree, ['merge', '--no-edit', base], { allowFail: true, env: this.authorEnv(authorName) });
    if (r.code === 0) return [];
    return (await this.exec(worktree, ['diff', '--name-only', '--diff-filter=U'], { allowFail: true })).stdout.split('\n').filter(Boolean);
  }

  /** Stage everything and commit as the agent. Returns null if there was nothing to commit. */
  async commitAll(worktree: string, message: string, authorName: string): Promise<CommitInfo | null> {
    await this.exec(worktree, ['add', '-A']);
    const staged = await this.exec(worktree, ['diff', '--cached', '--quiet'], { allowFail: true });
    if (staged.code === 0) return null;
    await this.exec(worktree, ['commit', '-m', message], { env: this.authorEnv(authorName) });
    return (await this.log(worktree, 'HEAD', 1))[0] ?? null;
  }

  async log(cwd: string, range: string, limit = 100): Promise<CommitInfo[]> {
    const r = await this.exec(cwd, ['log', `--format=${LOG_FORMAT}`, `-n`, String(limit), range], { allowFail: true });
    return r.code === 0 ? parseLog(r.stdout) : [];
  }

  /** Commits on branch that are not on base. */
  async branchCommits(repo: string, branch: string, base = this.base): Promise<CommitInfo[]> {
    return this.log(repo, `${base}..${branch}`);
  }

  async aheadBehind(repo: string, branch: string, base = this.base): Promise<{ ahead: number; behind: number }> {
    const r = await this.exec(repo, ['rev-list', '--left-right', '--count', `${base}...${branch}`], { allowFail: true });
    const [behind, ahead] = r.stdout.trim().split(/\s+/).map(Number);
    return { ahead: ahead || 0, behind: behind || 0 };
  }

  async isMerged(repo: string, branch: string, base = this.base): Promise<boolean> {
    const r = await this.exec(repo, ['merge-base', '--is-ancestor', branch, base], { allowFail: true });
    return r.code === 0;
  }

  async listBranches(repo: string): Promise<{ name: string; head: string }[]> {
    const r = await this.exec(repo, ['for-each-ref', 'refs/heads', '--format=%(refname:short)%09%(objectname)']);
    return r.stdout
      .split('\n')
      .filter(Boolean)
      .map((l) => {
        const [name, head] = l.split('\t');
        return { name, head };
      });
  }

  /** Files changed on branch relative to its merge-base with base (committed work). */
  async committedChanges(repo: string, branch: string, base = this.base): Promise<FileChange[]> {
    const [numstat, names] = await Promise.all([
      this.exec(repo, ['diff', '--numstat', `${base}...${branch}`], { allowFail: true }),
      this.exec(repo, ['diff', '--name-status', `${base}...${branch}`], { allowFail: true }),
    ]);
    const stats = new Map<string, [number, number]>();
    for (const l of numstat.stdout.split('\n').filter(Boolean)) {
      const [a, d, ...p] = l.split('\t');
      stats.set(p.join('\t'), [Number(a) || 0, Number(d) || 0]);
    }
    return names.stdout
      .split('\n')
      .filter(Boolean)
      .map((l) => {
        const [st, ...rest] = l.split('\t');
        const p = rest[rest.length - 1];
        const [additions, deletions] = stats.get(p) ?? [0, 0];
        return { path: p, status: statusOf(st), additions, deletions, staged: false, committed: true };
      });
  }

  /** Uncommitted changes inside a worktree. */
  async workingChanges(worktree: string): Promise<FileChange[]> {
    if (!fs.existsSync(worktree)) return [];
    const [porcelain, numstat] = await Promise.all([
      this.exec(worktree, ['status', '--porcelain=v1', '-uall'], { allowFail: true }),
      this.exec(worktree, ['diff', 'HEAD', '--numstat'], { allowFail: true }),
    ]);
    const stats = new Map<string, [number, number]>();
    for (const l of numstat.stdout.split('\n').filter(Boolean)) {
      const [a, d, ...p] = l.split('\t');
      stats.set(p.join('\t'), [Number(a) || 0, Number(d) || 0]);
    }
    return porcelain.stdout
      .split('\n')
      .filter(Boolean)
      .map((l) => {
        const x = l[0];
        const y = l[1];
        const p = l.slice(3).split(' -> ').pop()!;
        const untracked = x === '?';
        let additions = stats.get(p)?.[0] ?? 0;
        if (untracked) {
          try {
            additions = fs.readFileSync(path.join(worktree, p), 'utf8').split('\n').length;
          } catch {
            additions = 0;
          }
        }
        const code = untracked ? '?' : x !== ' ' ? x : y;
        return { path: p, status: untracked ? 'untracked' : statusOf(code), additions, deletions: stats.get(p)?.[1] ?? 0, staged: x !== ' ' && x !== '?', committed: false };
      });
  }

  /** Unified diff for one file: committed branch changes, plus uncommitted if a worktree is given. */
  async fileDiff(repo: string, branch: string, file: string, opts: { worktree?: string; base?: string } = {}): Promise<string> {
    const base = opts.base ?? this.base;
    if (opts.worktree && fs.existsSync(opts.worktree)) {
      const mb = (await this.exec(repo, ['merge-base', base, branch], { allowFail: true })).stdout.trim() || base;
      const tracked = await this.exec(opts.worktree, ['diff', mb, '--', file], { allowFail: true });
      if (tracked.stdout.trim()) return tracked.stdout;
      // untracked file: show as all-added
      const abs = path.join(opts.worktree, file);
      if (fs.existsSync(abs)) {
        const r = await this.exec(opts.worktree, ['diff', '--no-index', '--', '/dev/null', file], { allowFail: true });
        return r.stdout;
      }
      return '';
    }
    return (await this.exec(repo, ['diff', `${base}...${branch}`, '--', file], { allowFail: true })).stdout;
  }

  async fileAt(repo: string, ref: string, file: string): Promise<string | null> {
    const r = await this.exec(repo, ['show', `${ref}:${file}`], { allowFail: true });
    return r.code === 0 ? r.stdout : null;
  }

  async listFiles(worktree: string): Promise<string[]> {
    const r = await this.exec(worktree, ['ls-files', '--cached', '--others', '--exclude-standard'], { allowFail: true });
    return r.stdout.split('\n').filter(Boolean).sort();
  }

  /** Dry-run merge using merge-tree (no working tree touched). */
  async checkConflicts(repo: string, branch: string, base = this.base): Promise<{ clean: boolean; files: string[] }> {
    const r = await this.exec(repo, ['merge-tree', '--write-tree', '--name-only', '--no-messages', base, branch], { allowFail: true });
    if (r.code === 0) return { clean: true, files: [] };
    if (r.code === 1) {
      const lines = r.stdout.split('\n').filter(Boolean);
      return { clean: false, files: lines.slice(1) };
    }
    throw new GitError(`merge-tree failed: ${r.stderr}`, r.stderr, r.code);
  }

  /** Merge branch into base inside the main repository checkout. */
  async mergeIntoBase(repo: string, branch: string, message: string, base = this.base): Promise<string> {
    return this.lock(repo, async () => {
      const current = (await this.exec(repo, ['rev-parse', '--abbrev-ref', 'HEAD'])).stdout.trim();
      if (current !== base) await this.exec(repo, ['checkout', base]);
      const dirty = (await this.exec(repo, ['status', '--porcelain'])).stdout.trim();
      if (dirty) await this.exec(repo, ['stash', 'push', '-u', '-m', 'nexus: pre-merge autostash']);
      const r = await this.exec(repo, ['merge', '--no-ff', '-m', message, branch], { allowFail: true, env: this.authorEnv('NEXUS Orchestrator') });
      if (r.code !== 0) {
        await this.exec(repo, ['merge', '--abort'], { allowFail: true });
        throw new GitError(`Merge of ${branch} failed`, r.stderr || r.stdout, r.code);
      }
      return this.head(repo);
    });
  }

  /** Restore a file to its base version in a worktree and commit the revert. */
  async revertFile(worktree: string, file: string, authorName: string, base = this.base): Promise<CommitInfo | null> {
    const exists = await this.exec(worktree, ['cat-file', '-e', `${base}:${file}`], { allowFail: true });
    if (exists.code === 0) await this.exec(worktree, ['checkout', base, '--', file]);
    else {
      await this.exec(worktree, ['rm', '-f', '--cached', '--ignore-unmatch', '--', file], { allowFail: true });
      fs.rmSync(path.join(worktree, file), { force: true });
    }
    return this.commitAll(worktree, `revert: restore ${file} to ${base}`, authorName);
  }

  /** A temporary detached worktree of base with branch merged in (for integration checks). */
  async withIntegrationTree<T>(repo: string, branch: string, dir: string, fn: (dir: string) => Promise<T>, base = this.base): Promise<T> {
    await this.lock(repo, async () => {
      fs.rmSync(dir, { recursive: true, force: true });
      await this.exec(repo, ['worktree', 'prune']);
      await this.exec(repo, ['worktree', 'add', '--detach', dir, base]);
    });
    try {
      const m = await this.exec(dir, ['merge', '--no-ff', '--no-edit', branch], { allowFail: true, env: this.authorEnv('NEXUS Integration') });
      if (m.code !== 0) throw new GitError('Integration merge failed', m.stderr || m.stdout, m.code);
      return await fn(dir);
    } finally {
      await this.lock(repo, async () => {
        await this.exec(repo, ['worktree', 'remove', '--force', dir], { allowFail: true });
        await this.exec(repo, ['worktree', 'prune'], { allowFail: true });
      });
    }
  }
}

function statusOf(code: string): FileChange['status'] {
  switch (code[0]) {
    case 'A':
      return 'added';
    case 'D':
      return 'deleted';
    case 'R':
      return 'renamed';
    case '?':
      return 'untracked';
    default:
      return 'modified';
  }
}
