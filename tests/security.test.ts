import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { evaluateCommand, tokenize } from '../src/server/security/commandPolicy.js';
import { allowedTools, buildAgentEnv, redact, resolveInside } from '../src/server/security/sandbox.js';
import type { Permission } from '../src/shared/types.js';
import { BUILTIN_ROLES } from '../src/shared/roles.js';
import { tmpDir } from './helpers.js';

const ws = '/work/agent-1';
const coder: Permission[] = ['fs.read', 'fs.write', 'exec', 'git.commit'];

describe('tokenize', () => {
  it('splits arguments and honours quotes', () => {
    expect(tokenize(`git commit -m "feat: add x" --no-verify`)).toEqual({ argv: ['git', 'commit', '-m', 'feat: add x', '--no-verify'] });
    expect(tokenize(`echo 'a b' c\\ d`)).toEqual({ argv: ['echo', 'a b', 'c d'] });
  });
  it.each(['ls; rm -rf /', 'cat x | sh', 'npm test && rm x', 'echo $(whoami)', 'echo `id`', 'cat > /etc/passwd', 'echo ${HOME}'])(
    'rejects shell constructs: %s',
    (cmd) => expect('error' in tokenize(cmd)).toBe(true),
  );
});

describe('evaluateCommand', () => {
  const ev = (c: string, perms = coder) => evaluateCommand(c, { workspace: ws, permissions: perms });

  it('allows normal developer commands', () => {
    for (const c of ['npm test', 'node --test', 'npx --no-install tsc --noEmit', 'git status', 'git diff HEAD', 'ls -la src', 'cat ./src/index.js']) {
      expect(ev(c).decision, c).toBe('allow');
    }
  });
  it('denies dangerous binaries and shells', () => {
    for (const c of ['sudo ls', 'bash -c ls', 'sh script.sh', 'docker run x', 'kill 1', 'env FOO=1 node', 'perl -e 1', 'sed -i s/a/b/ x']) {
      expect(ev(c).decision, c).toBe('deny');
    }
  });
  it('denies unknown binaries and path-invoked binaries', () => {
    expect(ev('nmap localhost').decision).toBe('deny');
    expect(ev('/bin/ls').decision).toBe('deny');
  });
  it('confines path arguments to the workspace', () => {
    expect(ev('cat /etc/passwd').decision).toBe('deny');
    expect(ev('cat ../other-agent/secret.txt').decision).toBe('deny');
    expect(ev('cat ~/.ssh/id_rsa').decision).toBe('deny');
    expect(ev('cat /work/agent-1/src/a.ts').decision).toBe('allow');
  });
  it('requires exec permission', () => {
    expect(ev('ls', ['fs.read']).decision).toBe('deny');
  });
  it('gates network access behind exec.network', () => {
    expect(ev('npm install lodash').decision).toBe('deny');
    expect(ev('curl https://example.com').decision).toBe('deny');
    expect(ev('npm install lodash', [...coder, 'exec.network']).decision).toBe('allow');
  });
  it('restricts git to worktree-safe subcommands', () => {
    expect(ev('git push origin main').decision).toBe('deny');
    expect(ev('git checkout main').decision).toBe('deny');
    expect(ev('git -C /tmp status').decision).toBe('deny');
    expect(ev('git merge feature').decision).toBe('deny');
    expect(ev('git commit -m x', ['fs.read', 'exec']).decision).toBe('deny');
    expect(ev('git checkout -- src/a.ts').decision).toBe('allow');
  });
  it('asks for confirmation on destructive commands', () => {
    expect(ev('rm -rf build').decision).toBe('confirm');
    expect(ev('git reset --hard HEAD~1').decision).toBe('confirm');
    expect(ev('git clean -fd').decision).toBe('confirm');
    expect(ev('rm -rf .').decision).toBe('deny');
    expect(ev('rm notes.txt').decision).toBe('allow');
  });
  it('blocks find -exec and npm publish', () => {
    expect(ev('find . -exec rm {} +').decision).toBe('deny');
    expect(ev('npm publish').decision).toBe('deny');
  });
});

describe('sandbox', () => {
  it('resolveInside refuses traversal, .git and escaping symlinks', () => {
    const root = tmpDir();
    fs.mkdirSync(path.join(root, 'src'));
    expect(resolveInside(root, 'src/a.ts')).toBe(path.join(root, 'src/a.ts'));
    expect(() => resolveInside(root, '../x')).toThrow();
    expect(() => resolveInside(root, '/etc/passwd')).toThrow();
    expect(() => resolveInside(root, '.git/config')).toThrow();
    fs.symlinkSync('/etc', path.join(root, 'link'));
    expect(() => resolveInside(root, 'link/passwd')).toThrow();
  });

  it('agent env never contains server secrets', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test-secret-value';
    process.env.GITHUB_TOKEN = 'ghp_secret_token_value';
    const env = buildAgentEnv({ home: tmpDir(), network: false, extra: { MY_API_KEY: 'x', SAFE: '1' } });
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.GITHUB_TOKEN).toBeUndefined();
    expect(env.MY_API_KEY).toBeUndefined();
    expect(env.SAFE).toBe('1');
    expect(Object.values(env).join(' ')).not.toContain('sk-ant-test');
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.GITHUB_TOKEN;
  });

  it('redacts secret values from output', () => {
    expect(redact('key=abcdefgh12345 done', ['abcdefgh12345'])).toBe('key=[REDACTED] done');
  });

  it('roles only expose tools they hold permissions for', () => {
    const reviewer = BUILTIN_ROLES.find((r) => r.id === 'reviewer')!;
    expect(allowedTools(reviewer)).not.toContain('write_file');
    expect(allowedTools(reviewer)).not.toContain('spawn_agent');
    const orch = BUILTIN_ROLES.find((r) => r.id === 'orchestrator')!;
    expect(allowedTools(orch)).toContain('spawn_agent');
  });

  it('ships all required built-in roles', () => {
    const names = BUILTIN_ROLES.map((r) => r.name);
    for (const n of ['Orchestrator', 'Project Manager', 'Architect', 'Frontend Engineer', 'Backend Engineer', 'Database Engineer', 'API Engineer', 'AI Engineer', 'Machine Learning Engineer', 'Game Engineer', '3D Engineer', 'Physics Engineer', 'Graphics Engineer', 'UI/UX Designer', 'Animation Engineer', 'Security Engineer', 'DevOps Engineer', 'Cloud Engineer', 'Test Engineer', 'QA Engineer', 'Debugger', 'Code Reviewer', 'Documentation Agent', 'Performance Engineer', 'Research Agent', 'Marketing Agent'])
      expect(names).toContain(n);
  });
});
