import { useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { Permission, RoleDefinition } from '../../shared/types';
import { useStore } from '../store/store';
import { act, refreshRoles } from '../store/controller';
import { Badge, Button, Field, Input, Panel, Textarea } from '../components/ui';

const PERMS: Permission[] = ['fs.read', 'fs.write', 'exec', 'exec.network', 'git.commit', 'agents.spawn', 'tasks.create', 'merge.request', 'messages.broadcast'];
const TOOLS = ['list_files', 'read_file', 'write_file', 'edit_file', 'run_command', 'git_status', 'git_commit', 'send_message', 'spawn_agent', 'create_task', 'complete_task'];

function RoleEditor({ onDone }: { onDone: () => void }) {
  const [r, setR] = useState({ name: '', icon: '🤖', color: '#60a5fa', description: '', systemPrompt: 'You are a specialised engineer. ', permissions: ['fs.read', 'fs.write', 'exec', 'git.commit', 'merge.request'] as Permission[], tools: ['list_files', 'read_file', 'write_file', 'edit_file', 'run_command', 'git_status', 'git_commit', 'send_message', 'complete_task'], preferredModel: 'claude-opus-5-5', priority: 5 });
  const toggle = <T,>(xs: T[], x: T) => (xs.includes(x) ? xs.filter((y) => y !== x) : [...xs, x]);
  return (
    <div className="space-y-3 p-4">
      <div className="grid grid-cols-[64px_1fr_96px] gap-2">
        <Field label="Icon"><Input value={r.icon} onChange={(e) => setR({ ...r, icon: e.target.value })} /></Field>
        <Field label="Name"><Input value={r.name} onChange={(e) => setR({ ...r, name: e.target.value })} placeholder="e.g. Shader Specialist" /></Field>
        <Field label="Colour"><Input type="color" value={r.color} onChange={(e) => setR({ ...r, color: e.target.value })} className="h-[34px] p-1" /></Field>
      </div>
      <Field label="Description"><Input value={r.description} onChange={(e) => setR({ ...r, description: e.target.value })} /></Field>
      <Field label="System instructions"><Textarea rows={5} value={r.systemPrompt} onChange={(e) => setR({ ...r, systemPrompt: e.target.value })} /></Field>
      <Field label="Permissions">
        <div className="flex flex-wrap gap-1">{PERMS.map((p) => <button key={p} type="button" onClick={() => setR({ ...r, permissions: toggle(r.permissions, p) })} className={`rounded-md px-2 py-1 font-mono text-[10.5px] ${r.permissions.includes(p) ? 'bg-blue-500/20 text-blue-200' : 'bg-white/[0.04] text-ink-400'}`}>{p}</button>)}</div>
      </Field>
      <Field label="Tools">
        <div className="flex flex-wrap gap-1">{TOOLS.map((t) => <button key={t} type="button" onClick={() => setR({ ...r, tools: toggle(r.tools, t) })} className={`rounded-md px-2 py-1 font-mono text-[10.5px] ${r.tools.includes(t) ? 'bg-violet-500/20 text-violet-200' : 'bg-white/[0.04] text-ink-400'}`}>{t}</button>)}</div>
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Preferred model"><Input value={r.preferredModel} onChange={(e) => setR({ ...r, preferredModel: e.target.value })} /></Field>
        <Field label="Priority (0-10)"><Input type="number" min={0} max={10} value={r.priority} onChange={(e) => setR({ ...r, priority: Number(e.target.value) })} /></Field>
      </div>
      <div className="flex gap-2">
        <Button variant="primary" disabled={!r.name || !r.systemPrompt} onClick={async () => { if (await act((b) => b.saveRole(r), 'Role created')) { await refreshRoles(); onDone(); } }}>Create role</Button>
        <Button variant="ghost" onClick={onDone}>Cancel</Button>
      </div>
    </div>
  );
}

export default function RolesView() {
  const roles = useStore((s) => s.roles);
  const agents = useStore((s) => s.agents);
  const [sel, setSel] = useState<string | null>(roles[0]?.id ?? null);
  const [creating, setCreating] = useState(false);
  const role: RoleDefinition | undefined = roles.find((r) => r.id === sel);
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const a of Object.values(agents)) c[a.roleId] = (c[a.roleId] ?? 0) + 1;
    return c;
  }, [agents]);
  return (
    <div className="grid h-full grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] gap-3 p-4">
      <Panel title={`Agent roles · ${roles.length}`} actions={<Button variant="primary" icon={<Plus size={12} />} onClick={() => setCreating(true)}>Custom role</Button>} bodyClassName="overflow-y-auto p-3">
        <div className="grid grid-cols-2 gap-2 xl:grid-cols-3">
          {roles.map((r) => (
            <button key={r.id} onClick={() => { setSel(r.id); setCreating(false); }} className={`rounded-xl border p-3 text-left transition hover:border-white/20 ${sel === r.id && !creating ? 'border-blue-400/40 bg-blue-500/[0.06]' : 'border-white/[0.07] bg-white/[0.02]'}`}>
              <div className="flex items-center gap-2"><span className="text-lg">{r.icon}</span><span className="truncate text-[13px] font-medium text-white">{r.name}</span>{!r.builtin && <Badge color="#a78bfa">custom</Badge>}</div>
              <div className="mt-1 line-clamp-2 text-[11px] text-ink-400">{r.description}</div>
              <div className="mt-1.5 text-[10px] text-ink-500">{counts[r.id] ?? 0} agents · P{r.priority}</div>
            </button>
          ))}
        </div>
      </Panel>
      <Panel title={creating ? 'New custom role' : role?.name ?? 'Role'} actions={!creating && role && !role.builtin ? <Button variant="danger" icon={<Trash2 size={12} />} onClick={async () => { if (await act((b) => b.deleteRole(role.id), 'Role deleted')) await refreshRoles(); }}>Delete</Button> : undefined} bodyClassName="overflow-y-auto">
        {creating ? <RoleEditor onDone={() => setCreating(false)} /> : role && (
          <div className="space-y-4 p-4 text-[12.5px]">
            <div className="flex items-center gap-3"><span className="text-3xl">{role.icon}</span><div><div className="text-base font-semibold text-white">{role.name}</div><div className="text-ink-400">{role.description}</div></div></div>
            <div><div className="mb-1 text-[10px] uppercase tracking-wider text-ink-400">System instructions</div><pre className="mono max-h-64 overflow-y-auto whitespace-pre-wrap rounded-xl bg-black/30 p-3 text-[11px] text-ink-200">{role.systemPrompt}</pre></div>
            {([['Capabilities', role.capabilities], ['Tools', role.tools], ['Permissions', role.permissions], ['Task types', role.taskTypes]] as const).map(([k, v]) => (
              <div key={k}><div className="mb-1 text-[10px] uppercase tracking-wider text-ink-400">{k}</div><div className="flex flex-wrap gap-1">{v.map((x) => <Badge key={x}>{x}</Badge>)}</div></div>
            ))}
            <div className="grid grid-cols-2 gap-2 text-[11.5px]">
              {[['Preferred model', role.preferredModel], ['Priority', role.priority], ['Command timeout', `${role.limits.commandTimeoutSec}s`], ['Memory limit', `${role.limits.maxMemoryMb} MB`], ['Max iterations', role.limits.maxIterations], ['Token budget', role.limits.tokenBudget.toLocaleString()]].map(([k, v]) => (
                <div key={String(k)}><div className="text-[10px] uppercase tracking-wider text-ink-400">{k}</div><div className="mono text-ink-100">{v}</div></div>
              ))}
            </div>
          </div>
        )}
      </Panel>
    </div>
  );
}
