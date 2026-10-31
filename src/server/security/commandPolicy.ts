import path from 'node:path';
import type { Permission } from '../../shared/types.js';

export type PolicyDecision =
  | { decision: 'allow'; argv: string[]; network: boolean }
  | { decision: 'confirm'; argv: string[]; network: boolean; reason: string }
  | { decision: 'deny'; reason: string };

/**
 * Tokenise a command line WITHOUT a shell: supports single/double quotes and
 * backslash escapes; rejects every shell construct (pipes, redirects, expansions,
 * command chaining, subshells, globs are passed literally).
 */
export function tokenize(input: string): { argv: string[] } | { error: string } {
  const argv: string[] = [];
  let cur = '';
  let quote: '"' | "'" | null = null;
  let has = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (quote) {
      if (ch === quote) quote = null;
      else if (ch === '\\' && quote === '"' && i + 1 < input.length) cur += input[++i];
      else cur += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      has = true;
      continue;
    }
    if (ch === '\\' && i + 1 < input.length) {
      cur += input[++i];
      has = true;
      continue;
    }
    if (/\s/.test(ch)) {
      if (has || cur) argv.push(cur);
      cur = '';
      has = false;
      continue;
    }
    if (';|&<>`'.includes(ch) || (ch === '$' && (input[i + 1] === '(' || input[i + 1] === '{'))) {
      return { error: `Shell operator "${ch}" is not allowed. Commands run without a shell: run one command per call.` };
    }
    if (ch === '\n') return { error: 'Multi-line commands are not allowed.' };
    cur += ch;
    has = true;
  }
  if (quote) return { error: 'Unterminated quote in command.' };
  if (has || cur) argv.push(cur);
  if (!argv.length) return { error: 'Empty command.' };
  return { argv };
}

/** Binaries an agent may invoke. Anything else is denied. */
const ALLOWED_BINARIES = new Set([
  'node', 'npm', 'npx', 'pnpm', 'yarn', 'tsc', 'tsx', 'vitest', 'jest', 'eslint', 'prettier',
  'python3', 'python', 'pytest', 'pip', 'pip3', 'git', 'ls', 'cat', 'head', 'tail', 'wc', 'grep',
  'find', 'echo', 'mkdir', 'touch', 'cp', 'mv', 'rm', 'sort', 'uniq', 'diff', 'pwd', 'true',
  'false', 'make', 'cargo', 'go', 'rustc', 'deno', 'bun', 'test', 'tree', 'du', 'stat', 'date',
  'curl', 'wget',
]);

/** Always denied, regardless of permissions. */
const DENIED_BINARIES = new Set([
  'sudo', 'su', 'doas', 'chown', 'chmod', 'chroot', 'dd', 'mkfs', 'mount', 'umount', 'kill', 'pkill',
  'killall', 'shutdown', 'reboot', 'halt', 'poweroff', 'systemctl', 'service', 'docker', 'podman',
  'kubectl', 'ssh', 'scp', 'sftp', 'nc', 'ncat', 'netcat', 'telnet', 'socat', 'bash', 'sh', 'zsh',
  'fish', 'dash', 'ksh', 'csh', 'eval', 'exec', 'env', 'xargs', 'nohup', 'crontab', 'at', 'nsenter',
  'unshare', 'iptables', 'useradd', 'passwd', 'sed', 'awk', 'perl', 'ruby', 'php', 'osascript', 'powershell', 'pwsh',
]);

const NETWORK_BINARIES = new Set(['curl', 'wget', 'pip', 'pip3']);

const GIT_ALLOWED = new Set([
  'status', 'diff', 'log', 'show', 'add', 'commit', 'rev-parse', 'ls-files', 'mv', 'rm', 'restore',
  'stash', 'branch', 'blame', 'grep', 'shortlog', 'describe', 'tag', 'checkout', 'reset', 'clean',
]);
const GIT_DENIED = new Set([
  'push', 'pull', 'fetch', 'clone', 'remote', 'worktree', 'rebase', 'merge', 'switch', 'config',
  'filter-branch', 'gc', 'prune', 'reflog', 'update-ref', 'submodule', 'daemon', 'archive', 'bundle',
  'cherry-pick', 'am', 'apply', 'replace', 'notes', 'credential',
]);

export interface PolicyContext {
  /** Absolute path of the agent's workspace (git worktree). */
  workspace: string;
  permissions: Permission[];
}

function isInside(root: string, target: string): boolean {
  const rel = path.relative(root, target);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/** Arguments that look like paths must resolve inside the workspace. */
function checkPathArgs(argv: string[], ctx: PolicyContext): string | null {
  for (const a of argv.slice(1)) {
    const value = a.includes('=') && a.startsWith('-') ? a.slice(a.indexOf('=') + 1) : a;
    if (!value || /^[a-z]+:\/\//i.test(value)) continue; // URLs handled by network checks
    if (value.startsWith('~')) return `Home-directory paths are not allowed: ${a}`;
    const looksLikePath = value.startsWith('/') || value.startsWith('.') || value.includes('/');
    if (!looksLikePath) continue;
    if (value.startsWith('-')) continue;
    const resolved = path.resolve(ctx.workspace, value);
    if (!isInside(ctx.workspace, resolved)) return `Path escapes the agent workspace: ${a}`;
  }
  return null;
}

/** Evaluate a command line against the security policy for an agent. */
export function evaluateCommand(command: string, ctx: PolicyContext): PolicyDecision {
  if (!ctx.permissions.includes('exec')) return { decision: 'deny', reason: 'Role lacks the "exec" permission.' };
  if (command.length > 4000) return { decision: 'deny', reason: 'Command too long.' };
  const tok = tokenize(command);
  if ('error' in tok) return { decision: 'deny', reason: tok.error };
  const argv = tok.argv;
  const bin = argv[0];
  if (bin.includes('/')) return { decision: 'deny', reason: 'Invoke binaries by name, not by path.' };
  if (DENIED_BINARIES.has(bin)) return { decision: 'deny', reason: `"${bin}" is blocked by the security policy.` };
  if (!ALLOWED_BINARIES.has(bin)) return { decision: 'deny', reason: `"${bin}" is not on the command allowlist.` };

  const pathErr = checkPathArgs(argv, ctx);
  if (pathErr) return { decision: 'deny', reason: pathErr };

  let network = NETWORK_BINARIES.has(bin);
  const args = argv.slice(1);
  const sub = args.find((a) => !a.startsWith('-'));

  // Package managers: installing fetches from the network.
  if (['npm', 'pnpm', 'yarn', 'bun'].includes(bin)) {
    if (sub && ['publish', 'unpublish', 'login', 'logout', 'adduser', 'token', 'owner', 'deprecate', 'access'].includes(sub))
      return { decision: 'deny', reason: `"${bin} ${sub}" is not allowed.` };
    if (sub && ['install', 'i', 'ci', 'add', 'update', 'upgrade', 'dlx', 'create', 'init', 'exec', 'x'].includes(sub)) network = true;
    if (bin === 'yarn' && !sub) network = true;
  }
  if (bin === 'npx' && !args.includes('--no-install') && !args.includes('--offline')) network = true;
  if (bin === 'pip' || bin === 'pip3') network = true;
  if (bin === 'go' && sub && ['get', 'install', 'mod'].includes(sub)) network = true;
  if (bin === 'cargo' && sub && ['install', 'add', 'update', 'fetch', 'publish'].includes(sub)) network = true;
  if (bin === 'find' && args.some((a) => ['-exec', '-execdir', '-ok', '-okdir', '-delete'].includes(a)))
    return { decision: 'deny', reason: 'find -exec/-delete is not allowed.' };

  if (network && !ctx.permissions.includes('exec.network'))
    return { decision: 'deny', reason: `"${command}" needs network access; role lacks "exec.network".` };

  // Git: only safe, worktree-local subcommands. Merges happen through the merge queue.
  if (bin === 'git') {
    if (args.some((a) => a === '-C' || a.startsWith('--git-dir') || a.startsWith('--work-tree') || a === '-c'))
      return { decision: 'deny', reason: 'git -C/-c/--git-dir/--work-tree are not allowed.' };
    if (!sub) return { decision: 'deny', reason: 'Missing git subcommand.' };
    if (GIT_DENIED.has(sub)) return { decision: 'deny', reason: `"git ${sub}" is not allowed for agents (branches are merged via the merge queue).` };
    if (!GIT_ALLOWED.has(sub)) return { decision: 'deny', reason: `"git ${sub}" is not on the git allowlist.` };
    if (sub === 'commit' && !ctx.permissions.includes('git.commit')) return { decision: 'deny', reason: 'Role lacks "git.commit".' };
    if (sub === 'checkout' && !args.includes('--')) return { decision: 'deny', reason: 'Switching branches is not allowed; use "git checkout -- <path>" to restore files.' };
    if (sub === 'branch' && args.some((a) => ['-D', '-d', '-m', '-M', '--delete', '--move', '-f', '--force'].includes(a)))
      return { decision: 'deny', reason: 'Branch mutation is managed by NEXUS.' };
    if (sub === 'tag' && args.length > 1) return { decision: 'deny', reason: 'Creating tags is managed by NEXUS.' };
    if ((sub === 'reset' && args.includes('--hard')) || sub === 'clean' || (sub === 'checkout' && args.includes('.')))
      return { decision: 'confirm', argv, network: false, reason: `Destructive git operation: ${command}` };
  }

  // Filesystem destruction needs a human.
  if (bin === 'rm') {
    const recursive = args.some((a) => /^-[a-zA-Z]*[rR]/.test(a) || a === '--recursive');
    const wildcard = args.some((a) => a.includes('*'));
    const rootish = args.some((a) => ['.', './', '..', '*'].includes(a));
    if (rootish) return { decision: 'deny', reason: 'Refusing to remove the workspace root.' };
    if (recursive || wildcard) return { decision: 'confirm', argv, network, reason: `Destructive command: ${command}` };
  }
  if (['mv', 'cp', 'touch', 'mkdir', 'rm'].includes(bin) && !ctx.permissions.includes('fs.write'))
    return { decision: 'deny', reason: `"${bin}" modifies files; role lacks "fs.write".` };

  return { decision: 'allow', argv, network };
}
