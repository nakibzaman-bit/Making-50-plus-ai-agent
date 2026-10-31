import { useMemo, useState } from 'react';
import { Plus, RotateCcw, XCircle, Link2, ShieldCheck, ArrowRight, X } from 'lucide-react';
import clsx from 'clsx';
import type { Task, TaskStatus } from '../../shared/types';
import { useStore } from '../store/store';
import { act } from '../store/controller';
import { taskTone, TONE_HEX } from '../lib/status';
import { ago, duration } from '../lib/format';
import { Button, Panel, Pill, Select, Input } from '../components/ui';

const COLUMNS: { id: string; label: string; statuses: TaskStatus[] }[] = [
  { id: 'backlog', label: 'Backlog', statuses: ['backlog'] },
  { id: 'queued', label: 'Queued', statuses: ['queued', 'assigned'] },
  { id: 'working', label: 'Working', statuses: ['working', 'testing'] },
  { id: 'review', label: 'Review', statuses: ['review', 'waiting'] },
  { id: 'blocked', label: 'Blocked / Failed', statuses: ['blocked', 'failed'] },
  { id: 'done', label: 'Completed', statuses: ['completed', 'cancelled'] },
];

function TaskCard({ t }: { t: Task }) {
  const agent = useStore((s) => (t.assignedAgentId ? s.agents[t.assignedAgentId] : undefined));
  const tasks = useStore((s) => s.tasks);
  const selected = useStore((s) => s.selectedTaskId === t.id);
  const tone = taskTone(t.status);
  return (
    <button onClick={() => useStore.getState().openTask(t.id)} className={clsx('w-full rounded-xl border p-2.5 text-left transition hover:border-white/20', selected ? 'border-blue-400/50 bg-blue-500/[0.08]' : 'border-white/[0.07] bg-white/[0.025]')} style={{ boxShadow: `inset 2px 0 0 ${TONE_HEX[tone]}` }}>
      <div className="flex items-start gap-2">
        <div className="line-clamp-2 flex-1 text-[12.5px] font-medium text-ink-100">{t.title}</div>
        <span className="shrink-0 text-[10px] font-semibold text-ink-400">P{t.priority}</span>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        <Pill tone={tone} pulse={t.status === 'working'}>{t.status.toUpperCase()}</Pill>
        {t.kind !== 'work' && <span className="rounded bg-red-500/10 px-1 text-[9px] font-bold text-red-300">{t.kind.toUpperCase()}</span>}
        {t.requiresApproval && <ShieldCheck size={12} className="text-amber-300" />}
        {t.attempts > 1 && <span className="text-[10px] text-amber-300">attempt {t.attempts}/{t.maxAttempts}</span>}
      </div>
      <div className="mt-1.5 flex items-center justify-between text-[10.5px] text-ink-400">
        <span className="truncate">{agent ? agent.name : 'unassigned'}</span>
        {t.dependsOn.length > 0 && <span className="flex items-center gap-0.5" title={t.dependsOn.map((d) => tasks[d]?.title).join(', ')}><Link2 size={10} />{t.dependsOn.filter((d) => tasks[d]?.status === 'completed').length}/{t.dependsOn.length}</span>}
      </div>
      {t.error && t.status !== 'completed' && <div className="mt-1 line-clamp-2 text-[10.5px] text-red-300/90">{t.error}</div>}
    </button>
  );
}

function TaskDetail({ t }: { t: Task }) {
  const tasks = useStore((s) => s.tasks);
  const agents = useStore((s) => s.agents);
  const [dep, setDep] = useState('');
  const dependents = Object.values(tasks).filter((x) => x.dependsOn.includes(t.id));
  const elapsed = t.startedAt ? (t.completedAt ?? Date.now()) - t.startedAt : 0;
  return (
    <div className="glass-strong flex h-full w-[380px] shrink-0 flex-col rounded-2xl" style={{ animation: 'fade-up .2s ease-out' }}>
      <div className="flex items-start gap-2 border-b hairline p-4">
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-mono text-ink-400">{t.id}</div>
          <div className="text-[15px] font-semibold text-white">{t.title}</div>
          <div className="mt-1.5"><Pill tone={taskTone(t.status)}>{t.status.toUpperCase()}</Pill></div>
        </div>
        <button aria-label="Close" onClick={() => useStore.getState().openTask(null)} className="text-ink-400 hover:text-white"><X size={16} /></button>
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 text-[12.5px]">
        <p className="whitespace-pre-wrap text-ink-200">{t.description || 'No description.'}</p>
        <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-[11.5px]">
          {[
            ['Priority', `P${t.priority}`],
            ['Kind', t.kind],
            ['Branch', t.branch ?? '—'],
            ['Attempts', `${t.attempts}/${t.maxAttempts}`],
            ['Created', ago(t.createdAt)],
            ['Started', t.startedAt ? ago(t.startedAt) : '—'],
            ['Completed', t.completedAt ? ago(t.completedAt) : '—'],
            ['Duration', elapsed ? duration(elapsed) : '—'],
            ['Tests', t.tests ? `${t.tests.passed} ✓ / ${t.tests.failed} ✗` : '—'],
            ['Approval', t.requiresApproval ? 'required' : 'not required'],
          ].map(([k, v]) => (
            <div key={k}><dt className="text-[10px] uppercase tracking-wider text-ink-400">{k}</dt><dd className="mono truncate text-ink-100">{v}</dd></div>
          ))}
        </dl>
        <div>
          <div className="mb-1 text-[10px] uppercase tracking-wider text-ink-400">Assigned agent</div>
          <Select value={t.assignedAgentId ?? ''} onChange={(e) => void act((b) => b.reassignTask(t.id, e.target.value || null), 'Task reassigned')} className="text-xs">
            <option value="">Unassigned (orchestrator picks / spawns)</option>
            {Object.values(agents).map((a) => <option key={a.id} value={a.id}>{a.name} — {a.status}</option>)}
          </Select>
        </div>
        <div>
          <div className="mb-1 text-[10px] uppercase tracking-wider text-ink-400">Depends on</div>
          <div className="space-y-1">
            {t.dependsOn.map((d) => (
              <div key={d} className="flex items-center gap-2 rounded-lg bg-white/[0.03] px-2 py-1">
                <Pill tone={taskTone(tasks[d]?.status ?? 'backlog')}>{tasks[d]?.status ?? '?'}</Pill>
                <button className="flex-1 truncate text-left text-ink-200 hover:text-white" onClick={() => useStore.getState().openTask(d)}>{tasks[d]?.title ?? d}</button>
                <button aria-label="Remove dependency" className="text-ink-500 hover:text-red-300" onClick={() => void act((b) => b.removeDependency(t.id, d))}><X size={12} /></button>
              </div>
            ))}
            <div className="flex gap-1.5">
              <Select value={dep} onChange={(e) => setDep(e.target.value)} className="text-xs">
                <option value="">Add dependency…</option>
                {Object.values(tasks).filter((x) => x.id !== t.id && !t.dependsOn.includes(x.id)).map((x) => <option key={x.id} value={x.id}>{x.title}</option>)}
              </Select>
              <Button disabled={!dep} onClick={() => { void act((b) => b.addDependency(t.id, dep)); setDep(''); }}>Add</Button>
            </div>
          </div>
        </div>
        {dependents.length > 0 && (
          <div>
            <div className="mb-1 text-[10px] uppercase tracking-wider text-ink-400">Unblocks</div>
            {dependents.map((d) => <button key={d.id} onClick={() => useStore.getState().openTask(d.id)} className="flex w-full items-center gap-1.5 truncate py-0.5 text-left text-ink-200 hover:text-white"><ArrowRight size={11} className="text-ink-500" />{d.title}</button>)}
          </div>
        )}
        {t.files.length > 0 && (
          <div>
            <div className="mb-1 text-[10px] uppercase tracking-wider text-ink-400">Files ({t.files.length})</div>
            <div className="mono space-y-0.5 text-[11px] text-ink-300">{t.files.map((f) => <div key={f}>{f}</div>)}</div>
          </div>
        )}
        {t.result && <div><div className="mb-1 text-[10px] uppercase tracking-wider text-ink-400">Result</div><p className="text-emerald-200/90">{t.result}</p></div>}
        {t.error && <div><div className="mb-1 text-[10px] uppercase tracking-wider text-ink-400">Error</div><pre className="mono whitespace-pre-wrap rounded-lg bg-red-500/[0.07] p-2 text-[11px] text-red-200">{t.error}</pre></div>}
      </div>
      <div className="flex gap-2 border-t hairline p-3">
        <Button icon={<RotateCcw size={12} />} onClick={() => void act((b) => b.taskAction(t.id, 'retry'), 'Task re-queued')} disabled={['working', 'testing'].includes(t.status)}>Retry</Button>
        <Button variant="danger" icon={<XCircle size={12} />} onClick={() => void act((b) => b.taskAction(t.id, 'cancel'), 'Task cancelled')} disabled={['completed', 'cancelled'].includes(t.status)}>Cancel</Button>
        {t.assignedAgentId && <Button className="ml-auto" onClick={() => useStore.getState().select(t.assignedAgentId, 'terminal')}>Logs</Button>}
      </div>
    </div>
  );
}

export default function TasksView() {
  const tasks = useStore((s) => s.tasks);
  const selectedTaskId = useStore((s) => s.selectedTaskId);
  const [q, setQ] = useState('');
  const list = useMemo(() => Object.values(tasks).filter((t) => !q || t.title.toLowerCase().includes(q.toLowerCase())).sort((a, b) => b.priority - a.priority || a.createdAt - b.createdAt), [tasks, q]);
  const selected = selectedTaskId ? tasks[selectedTaskId] : undefined;
  return (
    <div className="flex h-full gap-3 p-4">
      <Panel
        title={`Task board · ${list.length} tasks`}
        className="min-w-0 flex-1"
        actions={<><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter tasks…" className="h-7 w-48 py-1 text-xs" /><Button variant="primary" icon={<Plus size={12} />} onClick={() => useStore.setState({ dialog: { kind: 'task' } })}>New task</Button></>}
        bodyClassName="overflow-x-auto"
      >
        <div className="grid h-full min-w-[1100px] grid-cols-6 gap-2.5 p-3">
          {COLUMNS.map((c) => {
            const items = list.filter((t) => c.statuses.includes(t.status));
            return (
              <div key={c.id} className="flex min-h-0 flex-col rounded-xl bg-black/15 p-2">
                <div className="mb-2 flex items-center justify-between px-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-400"><span>{c.label}</span><span className="text-ink-500">{items.length}</span></div>
                <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-0.5">{items.map((t) => <TaskCard key={t.id} t={t} />)}</div>
              </div>
            );
          })}
        </div>
      </Panel>
      {selected && <TaskDetail t={selected} />}
    </div>
  );
}

