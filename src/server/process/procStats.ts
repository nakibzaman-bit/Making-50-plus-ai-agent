import fs from 'node:fs';
import os from 'node:os';

const PAGE = 4096;
const CLK_TCK = 100;

interface ProcInfo {
  pid: number;
  ppid: number;
  cpuTicks: number;
  rssBytes: number;
}

function readProc(pid: number): ProcInfo | null {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    const close = stat.lastIndexOf(')');
    const fields = stat.slice(close + 2).split(' ');
    // fields[0] = state, [1] = ppid, [11] = utime, [12] = stime, [21] = rss pages
    return {
      pid,
      ppid: Number(fields[1]),
      cpuTicks: Number(fields[11]) + Number(fields[12]),
      rssBytes: Number(fields[21]) * PAGE,
    };
  } catch {
    return null;
  }
}

const hasProc = fs.existsSync('/proc/self/stat');

/** Snapshot of all processes (Linux /proc). Empty on platforms without /proc. */
export function processTable(): Map<number, ProcInfo> {
  const table = new Map<number, ProcInfo>();
  if (!hasProc) return table;
  for (const entry of fs.readdirSync('/proc')) {
    const pid = Number(entry);
    if (!Number.isInteger(pid)) continue;
    const info = readProc(pid);
    if (info) table.set(pid, info);
  }
  return table;
}

/** All descendants of the given root pids (inclusive). */
export function descendants(table: Map<number, ProcInfo>, roots: number[]): ProcInfo[] {
  const children = new Map<number, number[]>();
  for (const p of table.values()) children.set(p.ppid, [...(children.get(p.ppid) ?? []), p.pid]);
  const out: ProcInfo[] = [];
  const stack = [...roots];
  const seen = new Set<number>();
  while (stack.length) {
    const pid = stack.pop()!;
    if (seen.has(pid)) continue;
    seen.add(pid);
    const info = table.get(pid);
    if (info) out.push(info);
    stack.push(...(children.get(pid) ?? []));
  }
  return out;
}

/** Tracks CPU tick deltas so we can report CPU% per process group between samples. */
export class CpuMeter {
  private last = new Map<string, { ticks: number; at: number }>();

  percent(key: string, ticks: number): number {
    const at = Date.now();
    const prev = this.last.get(key);
    this.last.set(key, { ticks, at });
    if (!prev || at === prev.at) return 0;
    const cpuSec = (ticks - prev.ticks) / CLK_TCK;
    const wallSec = (at - prev.at) / 1000;
    return Math.max(0, (cpuSec / wallSec) * 100);
  }

  forget(key: string) {
    this.last.delete(key);
  }
}

let lastHost: { idle: number; total: number } | null = null;

export function hostCpuPercent(): number {
  const cpus = os.cpus();
  let idle = 0;
  let total = 0;
  for (const c of cpus) {
    idle += c.times.idle;
    total += c.times.user + c.times.nice + c.times.sys + c.times.idle + c.times.irq;
  }
  const prev = lastHost;
  lastHost = { idle, total };
  if (!prev || total === prev.total) return 0;
  return Math.max(0, Math.min(100, (1 - (idle - prev.idle) / (total - prev.total)) * 100));
}
