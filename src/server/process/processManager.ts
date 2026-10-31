import fs from 'node:fs';
import path from 'node:path';
import type { ChildProcess } from 'node:child_process';
import type { Permission } from '../../shared/types.js';
import { evaluateCommand, type PolicyDecision } from '../security/commandPolicy.js';
import { buildAgentEnv, collectSecretValues, redact } from '../security/sandbox.js';
import type { LogSink } from '../events/logSink.js';
import type { Executor } from './executor.js';
import { CpuMeter, descendants, processTable } from './procStats.js';
import { id as makeId } from '../util.js';

export interface RunOptions {
  projectId: string;
  agentId: string | null;
  taskId: string | null;
  command: string;
  cwd: string;
  /** Workspace root used for path policy (defaults to cwd). */
  workspace?: string;
  permissions: Permission[];
  timeoutSec: number;
  maxMemoryMb: number;
  /** Directory used as HOME for the process. */
  home: string;
  mounts?: string[];
  /** Echo the command into the log stream. */
  echo?: boolean;
  /** Called with a pending confirmation; resolve true to proceed. */
  confirm?: (reason: string) => Promise<boolean>;
  signal?: AbortSignal;
}

export interface RunResult {
  ok: boolean;
  code: number | null;
  signal: string | null;
  timedOut: boolean;
  killedForMemory: boolean;
  denied: string | null;
  durationMs: number;
  stdout: string;
  stderr: string;
}

interface Tracked {
  id: string;
  child: ChildProcess;
  projectId: string;
  agentId: string | null;
  command: string;
  startedAt: number;
  maxMemoryMb: number;
  onMemoryKill: () => void;
}

export interface AgentUsage {
  cpu: number;
  memMb: number;
  processes: number;
}

const OUTPUT_TAIL = 64 * 1024;

/** Owns every child process NEXUS starts: policy check → spawn → stream → limit → reap. */
export class ProcessManager {
  private running = new Map<string, Tracked>();
  private cpu = new CpuMeter();
  private secrets = collectSecretValues();
  private usage = new Map<string, AgentUsage & { projectId: string }>();
  private sampler: NodeJS.Timeout;

  constructor(
    private executor: Executor,
    private logs: LogSink,
    sampleMs = 1000,
  ) {
    this.sampler = setInterval(() => this.sample(), sampleMs);
    this.sampler.unref();
  }

  get executorKind() {
    return this.executor.kind;
  }

  policy(command: string, workspace: string, permissions: Permission[]): PolicyDecision {
    return evaluateCommand(command, { workspace, permissions });
  }

  async run(opts: RunOptions): Promise<RunResult> {
    const start = Date.now();
    const workspace = opts.workspace ?? opts.cwd;
    const log = (stream: 'cmd' | 'system' | 'stdout' | 'stderr', text: string) =>
      this.logs.line(opts.projectId, opts.agentId, opts.taskId, stream, text);
    const fail = (denied: string): RunResult => {
      log('system', `⛔ ${denied}`);
      return { ok: false, code: null, signal: null, timedOut: false, killedForMemory: false, denied, durationMs: Date.now() - start, stdout: '', stderr: denied };
    };

    const decision = this.policy(opts.command, workspace, opts.permissions);
    if (opts.echo !== false) log('cmd', `$ ${opts.command}`);
    if (decision.decision === 'deny') return fail(decision.reason);
    if (decision.decision === 'confirm') {
      if (!opts.confirm) return fail(`${decision.reason} (requires human approval)`);
      log('system', `⏸ Awaiting approval: ${decision.reason}`);
      const approved = await opts.confirm(decision.reason);
      if (!approved) return fail(`Denied by reviewer: ${decision.reason}`);
      log('system', '✓ Approved by reviewer');
    }
    if (opts.signal?.aborted) return fail('Aborted');

    fs.mkdirSync(opts.home, { recursive: true });
    const env = buildAgentEnv({ home: opts.home, network: decision.network });
    let child: ChildProcess;
    try {
      child = this.executor.spawn({
        argv: decision.argv,
        cwd: opts.cwd,
        env,
        network: decision.network,
        maxMemoryMb: opts.maxMemoryMb,
        mounts: opts.mounts,
      });
    } catch (e) {
      return fail(`Failed to start: ${(e as Error).message}`);
    }

    const pid = makeId('proc');
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let killedForMemory = false;

    const kill = () => this.killChild(child);
    const tracked: Tracked = {
      id: pid,
      child,
      projectId: opts.projectId,
      agentId: opts.agentId,
      command: opts.command,
      startedAt: start,
      maxMemoryMb: opts.maxMemoryMb,
      onMemoryKill: () => {
        killedForMemory = true;
        kill();
      },
    };
    this.running.set(pid, tracked);

    const timer = setTimeout(() => {
      timedOut = true;
      kill();
    }, opts.timeoutSec * 1000);
    const onAbort = () => kill();
    opts.signal?.addEventListener('abort', onAbort, { once: true });

    child.stdout?.on('data', (buf: Buffer) => {
      const text = redact(buf.toString('utf8'), this.secrets);
      stdout = (stdout + text).slice(-OUTPUT_TAIL);
      this.logs.write(opts.projectId, opts.agentId, opts.taskId, 'stdout', text);
    });
    child.stderr?.on('data', (buf: Buffer) => {
      const text = redact(buf.toString('utf8'), this.secrets);
      stderr = (stderr + text).slice(-OUTPUT_TAIL);
      this.logs.write(opts.projectId, opts.agentId, opts.taskId, 'stderr', text);
    });

    const result = await new Promise<RunResult>((resolve) => {
      let settled = false;
      const done = (code: number | null, signal: string | null, err?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        opts.signal?.removeEventListener('abort', onAbort);
        this.running.delete(pid);
        this.cpu.forget(pid);
        this.logs.end(opts.projectId, opts.agentId, opts.taskId);
        if (err) stderr += `\n${err.message}`;
        const durationMs = Date.now() - start;
        const ok = code === 0 && !timedOut && !killedForMemory;
        resolve({ ok, code, signal, timedOut, killedForMemory, denied: null, durationMs, stdout, stderr });
      };
      child.on('error', (err) => done(null, null, err));
      child.on('close', (code, signal) => done(code, signal));
    });

    const secs = (result.durationMs / 1000).toFixed(2);
    if (result.timedOut) log('system', `⏱ Timed out after ${opts.timeoutSec}s — process tree killed`);
    else if (result.killedForMemory) log('system', `💥 Exceeded memory limit (${opts.maxMemoryMb} MB) — killed`);
    else if (opts.signal?.aborted) log('system', '■ Stopped');
    else log('system', `${result.ok ? '✓' : '✗'} exit ${result.code ?? result.signal} in ${secs}s`);
    return result;
  }

  private killChild(child: ChildProcess) {
    if (child.pid === undefined || child.exitCode !== null) return;
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      try {
        child.kill('SIGTERM');
      } catch {
        /* already gone */
      }
    }
    setTimeout(() => {
      if (child.exitCode === null && child.pid !== undefined) {
        try {
          process.kill(-child.pid, 'SIGKILL');
        } catch {
          /* gone */
        }
      }
    }, 1500).unref();
  }

  /** Kill every process belonging to an agent (used by stop/pause). */
  killAgent(agentId: string): number {
    let n = 0;
    for (const t of this.running.values()) {
      if (t.agentId === agentId) {
        this.killChild(t.child);
        n++;
      }
    }
    return n;
  }

  killAll(): void {
    for (const t of this.running.values()) this.killChild(t.child);
  }

  list() {
    return [...this.running.values()].map((t) => ({
      id: t.id,
      pid: t.child.pid,
      agentId: t.agentId,
      projectId: t.projectId,
      command: t.command,
      startedAt: t.startedAt,
    }));
  }

  agentUsage(agentId: string): AgentUsage {
    const u = this.usage.get(agentId);
    return u ? { cpu: u.cpu, memMb: u.memMb, processes: u.processes } : { cpu: 0, memMb: 0, processes: 0 };
  }

  totals(projectId?: string): AgentUsage {
    let cpu = 0;
    let memMb = 0;
    let processes = 0;
    for (const u of this.usage.values()) {
      if (projectId && u.projectId !== projectId) continue;
      cpu += u.cpu;
      memMb += u.memMb;
      processes += u.processes;
    }
    return { cpu, memMb, processes };
  }

  /** Real CPU/RSS sampling of every tracked process tree; enforces memory limits. */
  sample(): void {
    if (!this.running.size) {
      this.usage.clear();
      return;
    }
    const table = processTable();
    const perAgent = new Map<string, AgentUsage & { projectId: string }>();
    for (const t of this.running.values()) {
      if (t.child.pid === undefined) continue;
      const tree = descendants(table, [t.child.pid]);
      const ticks = tree.reduce((s, p) => s + p.cpuTicks, 0);
      const rssMb = tree.reduce((s, p) => s + p.rssBytes, 0) / (1024 * 1024);
      const cpu = this.cpu.percent(t.id, ticks);
      if (rssMb > t.maxMemoryMb) t.onMemoryKill();
      const key = t.agentId ?? `system:${t.projectId}`;
      const u = perAgent.get(key) ?? { cpu: 0, memMb: 0, processes: 0, projectId: t.projectId };
      u.cpu += cpu;
      u.memMb += rssMb;
      u.processes += tree.length;
      perAgent.set(key, u);
    }
    this.usage = perAgent;
  }

  close() {
    clearInterval(this.sampler);
    this.killAll();
  }
}

export function agentHome(dataDir: string, agentId: string): string {
  return path.join(dataDir, 'homes', agentId);
}
