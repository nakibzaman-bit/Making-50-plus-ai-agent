import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function tmpDir(prefix = 'nexus-test-'): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export async function waitFor<T>(fn: () => T | Promise<T>, opts: { timeout?: number; interval?: number; message?: string } = {}): Promise<NonNullable<T>> {
  const deadline = Date.now() + (opts.timeout ?? 20000);
  let last: T | undefined;
  while (Date.now() < deadline) {
    last = await fn();
    if (last) return last as NonNullable<T>;
    await new Promise((r) => setTimeout(r, opts.interval ?? 50));
  }
  throw new Error(`waitFor timed out: ${opts.message ?? ''} (last=${JSON.stringify(last)})`);
}
