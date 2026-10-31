import fs from 'node:fs';
import path from 'node:path';
import type { Permission, RoleDefinition } from '../../shared/types.js';

/** Resolve a model/agent-supplied relative path, refusing anything outside the root. */
export function resolveInside(root: string, rel: string): string {
  if (typeof rel !== 'string' || !rel.length) throw new Error('Path is required.');
  if (rel.includes('\0')) throw new Error('Invalid path.');
  const resolved = path.resolve(root, rel);
  const relative = path.relative(root, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`Path escapes the workspace: ${rel}`);
  const parts = relative.split(path.sep);
  if (parts[0] === '.git') throw new Error('Direct access to .git is not allowed; use the git tools.');
  // Refuse to follow symlinks that point outside the workspace.
  let probe = resolved;
  while (probe.length >= root.length) {
    if (fs.existsSync(probe)) {
      const real = fs.realpathSync(probe);
      const realRoot = fs.realpathSync(root);
      const r = path.relative(realRoot, real);
      if (r.startsWith('..') || path.isAbsolute(r)) throw new Error(`Path resolves outside the workspace: ${rel}`);
      break;
    }
    probe = path.dirname(probe);
  }
  return resolved;
}

const SECRET_NAME = /(KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|AUTH|COOKIE|SESSION)/i;

/**
 * Environment for agent processes: an explicit allowlist. Secrets (API keys, tokens,
 * cloud credentials) held by the NEXUS server are never inherited.
 */
export function buildAgentEnv(opts: { home: string; extra?: Record<string, string>; network: boolean }): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
    HOME: opts.home,
    TMPDIR: path.join(opts.home, 'tmp'),
    LANG: process.env.LANG ?? 'C.UTF-8',
    TERM: 'dumb',
    CI: '1',
    FORCE_COLOR: '0',
    NO_COLOR: '1',
    NEXUS_AGENT: '1',
    npm_config_update_notifier: 'false',
    npm_config_fund: 'false',
    npm_config_audit: 'false',
    npm_config_cache: path.join(opts.home, '.npm'),
    GIT_TERMINAL_PROMPT: '0',
    GIT_CONFIG_NOSYSTEM: '1',
  };
  if (!opts.network) {
    env.npm_config_offline = 'true';
  } else {
    for (const k of ['HTTPS_PROXY', 'HTTP_PROXY', 'NO_PROXY', 'https_proxy', 'http_proxy', 'no_proxy', 'NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE']) {
      if (process.env[k]) env[k] = process.env[k];
    }
  }
  for (const [k, v] of Object.entries(opts.extra ?? {})) {
    if (!SECRET_NAME.test(k)) env[k] = v;
  }
  fs.mkdirSync(env.TMPDIR!, { recursive: true });
  return env;
}

/** Values of secret-looking server env vars, for output redaction. */
export function collectSecretValues(env: NodeJS.ProcessEnv = process.env): string[] {
  return Object.entries(env)
    .filter(([k, v]) => SECRET_NAME.test(k) && typeof v === 'string' && v.length >= 8)
    .map(([, v]) => v as string);
}

export function redact(text: string, secrets: string[]): string {
  let out = text;
  for (const s of secrets) if (out.includes(s)) out = out.split(s).join('[REDACTED]');
  return out;
}

export function hasPermission(role: Pick<RoleDefinition, 'permissions'>, p: Permission): boolean {
  return role.permissions.includes(p);
}

export class PermissionError extends Error {
  constructor(public permission: Permission, roleName: string) {
    super(`${roleName} lacks the "${permission}" permission.`);
  }
}

export function requirePermission(role: Pick<RoleDefinition, 'permissions' | 'name'>, p: Permission): void {
  if (!hasPermission(role, p)) throw new PermissionError(p, role.name);
}

/** Tools are only exposed to an agent if its role lists them AND it holds the needed permission. */
export const TOOL_PERMISSIONS: Record<string, Permission | null> = {
  list_files: 'fs.read',
  read_file: 'fs.read',
  write_file: 'fs.write',
  edit_file: 'fs.write',
  run_command: 'exec',
  git_status: 'fs.read',
  git_commit: 'git.commit',
  send_message: null,
  complete_task: null,
  spawn_agent: 'agents.spawn',
  create_task: 'tasks.create',
};

export function allowedTools(role: Pick<RoleDefinition, 'tools' | 'permissions'>): string[] {
  return role.tools.filter((t) => {
    if (!(t in TOOL_PERMISSIONS)) return false;
    const p = TOOL_PERMISSIONS[t];
    return p === null || role.permissions.includes(p);
  });
}
