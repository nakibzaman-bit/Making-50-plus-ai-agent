import { spawn, type ChildProcess } from 'node:child_process';

export interface ExecRequest {
  argv: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  network: boolean;
  maxMemoryMb: number;
  /** Extra host paths that must be visible (e.g. the main repo for git worktrees). */
  mounts?: string[];
}

/** Strategy that turns an argv into a running child process. */
export interface Executor {
  readonly kind: 'local' | 'docker';
  spawn(req: ExecRequest): ChildProcess;
  available(): Promise<{ ok: boolean; reason?: string }>;
}

/**
 * Runs commands as direct child processes (no shell), in their own process group so
 * the whole tree can be killed, with a scrubbed environment and cwd pinned to the
 * agent's worktree. This is policy-level isolation; use DockerExecutor for kernel-level
 * isolation (filesystem, network namespace, cgroup limits).
 */
export class LocalExecutor implements Executor {
  readonly kind = 'local' as const;

  spawn(req: ExecRequest): ChildProcess {
    return spawn(req.argv[0], req.argv.slice(1), {
      cwd: req.cwd,
      env: req.env,
      shell: false,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
  }

  async available() {
    return { ok: true };
  }
}

/**
 * Runs each command in a throwaway container: workspace bind-mounted, network disabled
 * unless the role has exec.network, memory/CPU capped by cgroups. Requires a running
 * Docker daemon and NEXUS_DOCKER_IMAGE (default node:22-bookworm).
 */
export class DockerExecutor implements Executor {
  readonly kind = 'docker' as const;
  constructor(private image = process.env.NEXUS_DOCKER_IMAGE ?? 'node:22-bookworm') {}

  buildArgs(req: ExecRequest): string[] {
    const args = ['run', '--rm', '-i', '--init', '--pids-limit', '512', '--security-opt', 'no-new-privileges', '--cap-drop', 'ALL'];
    args.push('--network', req.network ? 'bridge' : 'none');
    args.push('--memory', `${req.maxMemoryMb}m`, '--cpus', '1');
    if (typeof process.getuid === 'function') args.push('--user', `${process.getuid()}:${process.getgid?.() ?? 0}`);
    const mounts = new Set([req.cwd, ...(req.mounts ?? [])]);
    for (const m of mounts) args.push('-v', `${m}:${m}`);
    args.push('-w', req.cwd);
    for (const [k, v] of Object.entries(req.env)) if (k !== 'PATH' && v !== undefined) args.push('-e', `${k}=${v}`);
    args.push(this.image, ...req.argv);
    return args;
  }

  spawn(req: ExecRequest): ChildProcess {
    return spawn('docker', this.buildArgs(req), {
      cwd: req.cwd,
      env: { PATH: process.env.PATH },
      shell: false,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  }

  async available() {
    return new Promise<{ ok: boolean; reason?: string }>((resolve) => {
      const p = spawn('docker', ['info', '--format', '{{.ServerVersion}}'], { stdio: 'ignore' });
      p.on('error', () => resolve({ ok: false, reason: 'docker CLI not found' }));
      p.on('exit', (code) => resolve(code === 0 ? { ok: true } : { ok: false, reason: 'Docker daemon not reachable' }));
    });
  }
}
