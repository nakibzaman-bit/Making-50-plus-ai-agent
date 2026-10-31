import { afterAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { Db } from '../src/server/db/database.js';
import { Repositories } from '../src/server/db/repositories.js';
import { EventBus } from '../src/server/events/eventBus.js';
import { LogSink } from '../src/server/events/logSink.js';
import { LocalExecutor, DockerExecutor } from '../src/server/process/executor.js';
import { ProcessManager } from '../src/server/process/processManager.js';
import type { Permission } from '../src/shared/types.js';
import { tmpDir } from './helpers.js';

const db = new Db(':memory:');
const repos = new Repositories(db);
const bus = new EventBus();
const sink = new LogSink(repos, bus, 10);
const pm = new ProcessManager(new LocalExecutor(), sink, 200);
const ws = tmpDir();
const perms: Permission[] = ['fs.read', 'fs.write', 'exec'];
db.run("INSERT INTO projects (id,name,repo_path,settings,created_at,updated_at) VALUES ('p1','t','/x','{}',0,0)");

const base = { projectId: 'p1', agentId: 'a1', taskId: null, cwd: ws, permissions: perms, timeoutSec: 10, maxMemoryMb: 1024, home: path.join(ws, '.home') };

afterAll(() => pm.close());

describe('ProcessManager', () => {
  it('runs a real process and streams its output into logs', async () => {
    fs.writeFileSync(path.join(ws, 'hello.js'), 'console.log("hello from a real process"); console.error("warn line");');
    const r = await pm.run({ ...base, command: 'node hello.js' });
    expect(r.ok).toBe(true);
    expect(r.stdout).toContain('hello from a real process');
    sink.flush();
    const lines = repos.logs.forAgent('a1').map((l) => `${l.stream}:${l.line}`);
    expect(lines).toContain('cmd:$ node hello.js');
    expect(lines).toContain('stdout:hello from a real process');
    expect(lines).toContain('stderr:warn line');
  });

  it('reports non-zero exit codes', async () => {
    const r = await pm.run({ ...base, command: 'node -e "process.exit(3)"' });
    expect(r.ok).toBe(false);
    expect(r.code).toBe(3);
  });

  it('denies commands that violate policy without spawning', async () => {
    const r = await pm.run({ ...base, command: 'cat /etc/passwd' });
    expect(r.ok).toBe(false);
    expect(r.denied).toMatch(/escapes/);
  });

  it('kills the process tree on timeout', async () => {
    const r = await pm.run({ ...base, timeoutSec: 1, command: 'node -e "setInterval(()=>{},1000)"' });
    expect(r.timedOut).toBe(true);
    expect(r.ok).toBe(false);
  });

  it('can stop all of an agent\'s processes', async () => {
    const p = pm.run({ ...base, agentId: 'a2', command: 'node -e "setInterval(()=>{},1000)"' });
    await new Promise((r) => setTimeout(r, 300));
    expect(pm.list().some((x) => x.agentId === 'a2')).toBe(true);
    expect(pm.killAgent('a2')).toBe(1);
    const r = await p;
    expect(r.ok).toBe(false);
  });

  it('samples real CPU and memory usage from /proc', async () => {
    const p = pm.run({ ...base, agentId: 'a3', timeoutSec: 3, command: 'node -e "const e=Date.now()+1500;while(Date.now()<e){}"' });
    await new Promise((r) => setTimeout(r, 1100));
    const u = pm.agentUsage('a3');
    expect(u.memMb).toBeGreaterThan(5);
    expect(u.cpu).toBeGreaterThan(10);
    await p;
  });

  it('enforces the memory limit', async () => {
    const r = await pm.run({ ...base, agentId: 'a4', maxMemoryMb: 60, timeoutSec: 10, command: 'node -e "const a=[];setInterval(()=>a.push(Buffer.alloc(20e6,1)),50)"' });
    expect(r.killedForMemory).toBe(true);
  });

  it('asks for confirmation for destructive commands and honours denial', async () => {
    fs.mkdirSync(path.join(ws, 'build'));
    const denied = await pm.run({ ...base, command: 'rm -r build', confirm: async () => false });
    expect(denied.ok).toBe(false);
    expect(fs.existsSync(path.join(ws, 'build'))).toBe(true);
    const ok = await pm.run({ ...base, command: 'rm -r build', confirm: async () => true });
    expect(ok.ok).toBe(true);
    expect(fs.existsSync(path.join(ws, 'build'))).toBe(false);
  });

  it('does not leak the server API key into agent processes', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-should-never-leak-123';
    const leak = new ProcessManager(new LocalExecutor(), sink, 1000);
    const r = await leak.run({ ...base, command: 'node -e "console.log(JSON.stringify(process.env))"' });
    expect(r.stdout).not.toContain('sk-ant-should-never-leak-123');
    leak.close();
    delete process.env.ANTHROPIC_API_KEY;
  });

  it('DockerExecutor builds an isolated docker invocation', () => {
    const args = new DockerExecutor('node:22').buildArgs({ argv: ['npm', 'test'], cwd: '/w', env: { CI: '1', PATH: '/bin' }, network: false, maxMemoryMb: 512, mounts: ['/repo'] });
    expect(args).toEqual(expect.arrayContaining(['--network', 'none', '--memory', '512m', '-v', '/w:/w', '-v', '/repo:/repo', '-w', '/w', 'node:22', 'npm', 'test']));
    expect(args).toContain('no-new-privileges');
  });
});
