import { useMemo, useState } from 'react';
import { ChevronRight, ChevronDown } from 'lucide-react';
import clsx from 'clsx';
import type { Agent } from '../../shared/types';
import { useStore } from '../store/store';
import { agentTone, AGENT_STATUS_LABEL } from '../lib/status';
import { Panel, StatusDot } from '../components/ui';

function Row({ a, depth, kids, byParent }: { a: Agent; depth: number; kids: Agent[]; byParent: Map<string, Agent[]> }) {
  const [open, setOpen] = useState(true);
  const role = useStore((s) => s.roles.find((r) => r.id === a.roleId));
  const team = useStore((s) => (a.teamId ? s.teams[a.teamId] : undefined));
  const task = useStore((s) => (a.currentTaskId ? s.tasks[a.currentTaskId] : undefined));
  const selected = useStore((s) => s.selectedAgentId === a.id);
  const tone = agentTone(a.status);
  return (
    <>
      <div className={clsx('group flex cursor-pointer items-center gap-2 rounded-lg py-1.5 pr-3 transition hover:bg-white/[0.04]', selected && 'bg-blue-500/10')} style={{ paddingLeft: 8 + depth * 22 }} onClick={() => useStore.getState().select(a.id)}>
        <button className="grid h-4 w-4 place-items-center text-ink-400" onClick={(e) => { e.stopPropagation(); setOpen(!open); }} aria-label={open ? 'Collapse' : 'Expand'}>
          {kids.length ? open ? <ChevronDown size={13} /> : <ChevronRight size={13} /> : <span className="h-px w-2 bg-ink-600" />}
        </button>
        <span className="text-base">{role?.icon ?? '🤖'}</span>
        <span className="text-[13px] font-medium text-ink-100">{a.name}</span>
        {team && depth <= 1 && <span className="rounded px-1.5 text-[9px] font-semibold uppercase tracking-wider" style={{ color: team.color, background: `${team.color}18` }}>{team.name}</span>}
        <span className="text-[11px] text-ink-400">{role?.name}</span>
        <span className="ml-auto flex items-center gap-2">
          <span className="max-w-[320px] truncate text-[11px] text-ink-300">{task?.title ?? a.statusReason ?? ''}</span>
          <StatusDot tone={tone} pulse={a.status === 'working'} />
          <span className="w-24 text-right text-[10px] font-semibold tracking-wider text-ink-300">{AGENT_STATUS_LABEL[a.status]}</span>
          {kids.length > 0 && <span className="w-8 text-right text-[10px] text-ink-500">{kids.length}</span>}
        </span>
      </div>
      {open && kids.map((k) => <Row key={k.id} a={k} depth={depth + 1} kids={byParent.get(k.id) ?? []} byParent={byParent} />)}
    </>
  );
}

export default function TreeView() {
  const agents = useStore((s) => s.agents);
  const { roots, byParent } = useMemo(() => {
    const list = Object.values(agents).sort((a, b) => a.createdAt - b.createdAt);
    const ids = new Set(list.map((a) => a.id));
    const byParent = new Map<string, Agent[]>();
    const roots: Agent[] = [];
    for (const a of list) {
      if (a.parentId && ids.has(a.parentId)) byParent.set(a.parentId, [...(byParent.get(a.parentId) ?? []), a]);
      else roots.push(a);
    }
    return { roots, byParent };
  }, [agents]);
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const a of Object.values(agents)) c[a.status] = (c[a.status] ?? 0) + 1;
    return c;
  }, [agents]);
  return (
    <div className="h-full p-4">
      <Panel title={`Agent hierarchy · ${Object.keys(agents).length} agents`} actions={<span className="text-[11px] text-ink-400">{Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(' · ')}</span>} className="h-full" bodyClassName="overflow-y-auto p-2">
        {roots.map((r) => <Row key={r.id} a={r} depth={0} kids={byParent.get(r.id) ?? []} byParent={byParent} />)}
      </Panel>
    </div>
  );
}
