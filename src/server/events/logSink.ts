import type { LogLine, LogStream } from '../../shared/types.js';
import type { Repositories } from '../db/repositories.js';
import type { EventBus } from './eventBus.js';

const MAX_LINE = 4000;

/**
 * Buffers real process output and flushes it to SQLite + WebSocket in batches,
 * so a chatty build doesn't produce one DB write and one WS frame per line.
 */
export class LogSink {
  private buffer: Omit<LogLine, 'id'>[] = [];
  private timer: NodeJS.Timeout | null = null;
  private partial = new Map<string, string>();
  private listeners = new Set<(lines: LogLine[]) => void>();

  constructor(
    private repos: Repositories,
    private bus: EventBus,
    private flushMs = 80,
  ) {}

  /** Subscribe to flushed lines (used by tests and the scheduler for test-result parsing). */
  onFlush(fn: (lines: LogLine[]) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  write(projectId: string, agentId: string | null, taskId: string | null, stream: LogStream, text: string): void {
    // Handle chunks that split lines: keep the trailing partial per (agent, stream).
    const key = `${agentId}:${stream}`;
    const combined = (this.partial.get(key) ?? '') + text;
    const parts = combined.split(/\r?\n/);
    const tail = parts.pop() ?? '';
    if (tail.length > MAX_LINE) {
      parts.push(tail);
      this.partial.delete(key);
    } else if (tail) this.partial.set(key, tail);
    else this.partial.delete(key);
    for (const raw of parts) this.push(projectId, agentId, taskId, stream, raw);
  }

  line(projectId: string, agentId: string | null, taskId: string | null, stream: LogStream, line: string): void {
    for (const l of line.split('\n')) this.push(projectId, agentId, taskId, stream, l);
  }

  /** Flush any dangling partial line for an agent stream (call when a process exits). */
  end(projectId: string, agentId: string | null, taskId: string | null): void {
    for (const stream of ['stdout', 'stderr'] as LogStream[]) {
      const key = `${agentId}:${stream}`;
      const rest = this.partial.get(key);
      if (rest) this.push(projectId, agentId, taskId, stream, rest);
      this.partial.delete(key);
    }
  }

  private push(projectId: string, agentId: string | null, taskId: string | null, stream: LogStream, line: string) {
    const clean = stripAnsi(line).slice(0, MAX_LINE);
    this.buffer.push({ projectId, agentId, taskId, stream, line: clean, createdAt: Date.now() });
    if (!this.timer) this.timer = setTimeout(() => this.flush(), this.flushMs);
  }

  flush(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (!this.buffer.length) return;
    const batch = this.buffer;
    this.buffer = [];
    let saved: LogLine[];
    try {
      saved = this.repos.logs.insertMany(batch);
    } catch {
      return; // DB closed during shutdown
    }
    const byProject = new Map<string, LogLine[]>();
    for (const l of saved) byProject.set(l.projectId, [...(byProject.get(l.projectId) ?? []), l]);
    for (const [projectId, lines] of byProject) this.bus.emit({ type: 'log.batch', projectId, lines });
    for (const fn of this.listeners) fn(saved);
  }
}

// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007]*\u0007/g;
export function stripAnsi(s: string): string {
  return s.replace(ANSI, '');
}
