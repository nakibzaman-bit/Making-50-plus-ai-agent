import { useMemo, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { useStore } from '../../store/store';
import { act, openProject } from '../../store/controller';
import { Button, Field, Input, Select, Textarea, Toggle } from '../ui';

function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[70] grid place-items-center bg-black/55 backdrop-blur-sm" onMouseDown={onClose}>
      <div className="glass-strong w-[520px] max-w-[94vw] rounded-2xl" onMouseDown={(e) => e.stopPropagation()} style={{ animation: 'fade-up .18s ease-out' }} role="dialog" aria-label={title}>
        <div className="flex items-center justify-between border-b hairline px-5 py-3.5">
          <h2 className="text-[15px] font-semibold text-white">{title}</h2>
          <button aria-label="Close" onClick={onClose} className="text-ink-400 hover:text-white"><X size={16} /></button>
        </div>
        <div className="space-y-3.5 p-5">{children}</div>
      </div>
    </div>
  );
}

function SpawnDialog({ close }: { close: () => void }) {
  const roles = useStore((s) => s.roles);
  const teams = useStore((s) => s.teams);
  const agents = useStore((s) => s.agents);
  const projectId = useStore((s) => s.projectId)!;
  const system = useStore((s) => s.system);
  const defaultRuntime = useStore((s) => s.project?.settings.defaultRuntime ?? 'claude');
  const [roleId, setRoleId] = useState('frontend');
  const [name, setName] = useState('');
  const [teamId, setTeamId] = useState('');
  const [parentId, setParentId] = useState('');
  const [runtime, setRuntime] = useState<'claude' | 'scripted'>(defaultRuntime);
  const [count, setCount] = useState(1);
  const role = roles.find((r) => r.id === roleId);
  const llmOff = system && !system.runtimes.find((r) => r.kind === 'claude')?.available;
  const submit = async () => {
    const r = await act((b) => b.spawnAgent(projectId, { roleId, name: name || undefined, teamId: teamId || null, parentId: parentId || null, runtime, count }), count > 1 ? `Spawned ${count} agents` : 'Agent spawned');
    if (r) close();
  };
  return (
    <Modal title="Spawn agent" onClose={close}>
      <Field label="Role">
        <Select value={roleId} onChange={(e) => setRoleId(e.target.value)}>
          {roles.map((r) => <option key={r.id} value={r.id}>{r.icon} {r.name}</option>)}
        </Select>
      </Field>
      {role && <p className="-mt-1 text-[11.5px] text-ink-400">{role.description}</p>}
      <div className="grid grid-cols-[1fr_96px] gap-3">
        <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder={role?.name} /></Field>
        <Field label="Count"><Input type="number" min={1} max={100} value={count} onChange={(e) => setCount(Math.max(1, Math.min(100, Number(e.target.value))))} /></Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Team"><Select value={teamId} onChange={(e) => setTeamId(e.target.value)}><option value="">No team</option>{Object.values(teams).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select></Field>
        <Field label="Reports to"><Select value={parentId} onChange={(e) => setParentId(e.target.value)}><option value="">Orchestrator</option>{Object.values(agents).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select></Field>
      </div>
      <Field label="Runtime" hint={runtime === 'claude' && llmOff ? 'ANTHROPIC_API_KEY is not configured: Claude agents will wait in the queue.' : runtime === 'scripted' ? 'Scripted agents only run tasks that carry an explicit step script.' : 'Claude works in its own worktree with permission-gated tools.'}>
        <Select value={runtime} onChange={(e) => setRuntime(e.target.value as 'claude' | 'scripted')}>
          <option value="claude">Claude (LLM)</option>
          <option value="scripted">Scripted (no LLM)</option>
        </Select>
      </Field>
      <div className="flex justify-end gap-2 pt-1"><Button variant="ghost" onClick={close}>Cancel</Button><Button variant="primary" size="md" onClick={submit} data-testid="spawn-submit">Spawn{count > 1 ? ` ${count}` : ''}</Button></div>
    </Modal>
  );
}

function TaskDialog({ close, preset }: { close: () => void; preset?: Record<string, unknown> }) {
  const roles = useStore((s) => s.roles);
  const agents = useStore((s) => s.agents);
  const tasks = useStore((s) => s.tasks);
  const projectId = useStore((s) => s.projectId)!;
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState(5);
  const [assignedAgentId, setAssigned] = useState((preset?.assignedAgentId as string) ?? '');
  const [roleHint, setRoleHint] = useState('');
  const [deps, setDeps] = useState<string[]>([]);
  const [approval, setApproval] = useState(false);
  const taskList = useMemo(() => Object.values(tasks).sort((a, b) => b.createdAt - a.createdAt), [tasks]);
  const submit = async () => {
    const r = await act((b) => b.createTask(projectId, { title, description, priority, assignedAgentId: assignedAgentId || null, roleHint: roleHint || null, dependsOn: deps, requiresApproval: approval }), 'Task created');
    if (r) close();
  };
  return (
    <Modal title="Create task" onClose={close}>
      <Field label="Title"><Input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Add /users endpoint with validation" /></Field>
      <Field label="Description & acceptance criteria"><Textarea rows={4} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
      <div className="grid grid-cols-[1fr_1fr_80px] gap-3">
        <Field label="Assign to"><Select value={assignedAgentId} onChange={(e) => setAssigned(e.target.value)}><option value="">Auto (by role)</option>{Object.values(agents).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select></Field>
        <Field label="Role (if auto)"><Select value={roleHint} onChange={(e) => setRoleHint(e.target.value)} disabled={Boolean(assignedAgentId)}><option value="">Backend Engineer</option>{roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</Select></Field>
        <Field label="Priority"><Input type="number" min={0} max={10} value={priority} onChange={(e) => setPriority(Number(e.target.value))} /></Field>
      </div>
      <Field label={`Depends on (${deps.length})`}>
        <select multiple value={deps} onChange={(e) => setDeps([...e.target.selectedOptions].map((o) => o.value))} className="h-24 w-full rounded-lg border border-white/[0.08] bg-black/30 p-1 text-xs text-ink-100">
          {taskList.map((t) => <option key={t.id} value={t.id}>{t.title} — {t.status}</option>)}
        </select>
      </Field>
      <Toggle checked={approval} onChange={setApproval} label="Require human approval before merge" />
      <div className="flex justify-end gap-2 pt-1"><Button variant="ghost" onClick={close}>Cancel</Button><Button variant="primary" size="md" onClick={submit} disabled={!title.trim()}>Create task</Button></div>
    </Modal>
  );
}

function ProjectDialog({ close }: { close: () => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [testCommand, setTest] = useState('npm test');
  const submit = async () => {
    const p = await act((b) => b.createProject({ name, description, settings: { testCommand } }), 'Project created');
    if (p) {
      useStore.setState((s) => ({ projects: s.projects.some((x) => x.id === p.id) ? s.projects : [...s.projects, p] }));
      close();
      void openProject(p.id);
    }
  };
  return (
    <Modal title="New project" onClose={close}>
      <Field label="Name"><Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Football Game" /></Field>
      <Field label="Description"><Input value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
      <Field label="Test command" hint="NEXUS creates a fresh git repository; agents get worktrees of it."><Input className="mono" value={testCommand} onChange={(e) => setTest(e.target.value)} /></Field>
      <div className="flex justify-end gap-2 pt-1"><Button variant="ghost" onClick={close}>Cancel</Button><Button variant="primary" size="md" onClick={submit} disabled={!name.trim()}>Create</Button></div>
    </Modal>
  );
}

function TeamDialog({ close }: { close: () => void }) {
  const projectId = useStore((s) => s.projectId)!;
  const [name, setName] = useState('');
  return (
    <Modal title="Create team" onClose={close}>
      <Field label="Team name"><Input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && name && void act((b) => b.createTeam(projectId, name), 'Team created').then(close)} placeholder="e.g. Gameplay" /></Field>
      <div className="flex justify-end gap-2"><Button variant="ghost" onClick={close}>Cancel</Button><Button variant="primary" size="md" disabled={!name.trim()} onClick={() => void act((b) => b.createTeam(projectId, name), 'Team created').then(close)}>Create</Button></div>
    </Modal>
  );
}

export function Dialogs() {
  const dialog = useStore((s) => s.dialog);
  const projectId = useStore((s) => s.projectId);
  const close = () => useStore.setState({ dialog: null });
  if (!dialog) return null;
  if (dialog.kind === 'project') return <ProjectDialog close={close} />;
  if (!projectId) return null;
  if (dialog.kind === 'spawn') return <SpawnDialog close={close} />;
  if (dialog.kind === 'task') return <TaskDialog close={close} preset={dialog.preset} />;
  return <TeamDialog close={close} />;
}
