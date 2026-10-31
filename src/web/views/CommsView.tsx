import { memo, useMemo, useRef, useState, useEffect } from 'react';
import { Send } from 'lucide-react';
import clsx from 'clsx';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { Message, MessageKind } from '../../shared/types';
import { useStore } from '../store/store';
import { act } from '../store/controller';
import { clock } from '../lib/format';
import { Button, Input, Panel, Select } from '../components/ui';

const KIND_STYLE: Record<MessageKind, { label: string; color: string }> = {
  direct: { label: 'DM', color: '#a855f7' },
  team: { label: 'TEAM', color: '#22d3ee' },
  broadcast: { label: 'ALL', color: '#f472b6' },
  task: { label: 'TASK', color: '#60a5fa' },
  system: { label: 'SYS', color: '#8b96b4' },
  user: { label: 'YOU', color: '#34d399' },
};

export const MessageRow = memo(function MessageRow({ m, dense }: { m: Message; dense?: boolean }) {
  const from = useStore((s) => (m.fromAgentId ? s.agents[m.fromAgentId] : undefined));
  const to = useStore((s) => (m.toAgentId ? s.agents[m.toAgentId] : undefined));
  const team = useStore((s) => (m.teamId ? s.teams[m.teamId] : undefined));
  const icon = useStore((s) => s.roles.find((r) => r.id === from?.roleId)?.icon);
  const k = KIND_STYLE[m.kind];
  const fromName = from?.name ?? (m.meta?.fromName as string | undefined) ?? (m.kind === 'system' ? 'System' : m.kind === 'user' ? 'You' : 'Orchestrator');
  return (
    <div className={clsx('group flex gap-2 rounded-lg px-1.5 transition hover:bg-white/[0.03]', dense ? 'py-0.5 text-[11.5px]' : 'py-1.5 text-[13px]')} style={{ animation: 'fade-up .2s ease-out' }}>
      <span className="mono shrink-0 pt-px text-[10px] text-ink-500">{clock(m.createdAt)}</span>
      <span className="mt-px h-fit shrink-0 rounded px-1 text-[9px] font-bold tracking-wider" style={{ color: k.color, background: `${k.color}1a` }}>{k.label}</span>
      <div className="min-w-0 flex-1">
        <button className="font-medium text-ink-100 hover:text-white" onClick={() => from && useStore.getState().select(from.id, 'messages')}>{icon ? `${icon} ` : ''}{fromName}</button>
        {(to || team) && <span className="text-ink-400"> → {to?.name ?? `#${team?.name}`}</span>}
        <span className={clsx('ml-1.5', m.kind === 'system' ? 'text-ink-300' : 'text-ink-200')}>{m.body}</span>
      </div>
    </div>
  );
});

export default function CommsView() {
  const messages = useStore((s) => s.messages);
  const agents = useStore((s) => s.agents);
  const teams = useStore((s) => s.teams);
  const projectId = useStore((s) => s.projectId);
  const [filter, setFilter] = useState<MessageKind | 'all'>('all');
  const [q, setQ] = useState('');
  const [to, setTo] = useState('');
  const [body, setBody] = useState('');
  const list = useMemo(() => messages.filter((m) => (filter === 'all' || m.kind === filter) && (!q || m.body.toLowerCase().includes(q.toLowerCase()))), [messages, filter, q]);
  const parentRef = useRef<HTMLDivElement>(null);
  const v = useVirtualizer({ count: list.length, getScrollElement: () => parentRef.current, estimateSize: () => 34, overscan: 12 });
  useEffect(() => {
    if (list.length) v.scrollToIndex(list.length - 1, { align: 'end' });
  }, [list.length, v]);

  const send = async () => {
    if (!projectId || !body.trim()) return;
    const [kind, id] = to.split(':');
    await act((b) => b.sendMessage(projectId, { body: body.trim(), toAgentId: kind === 'a' ? id : null, teamId: kind === 't' ? id : null }));
    setBody('');
  };

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <Panel
        title="Communications"
        className="flex-1"
        actions={
          <>
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter…" className="h-7 w-44 py-1 text-xs" />
            <div className="flex gap-0.5">
              {(['all', 'direct', 'team', 'broadcast', 'task', 'system', 'user'] as const).map((k) => (
                <button key={k} onClick={() => setFilter(k)} className={clsx('rounded-md px-2 py-1 text-[10px] font-semibold uppercase tracking-wider', filter === k ? 'bg-white/10 text-white' : 'text-ink-400 hover:text-ink-100')}>{k}</button>
              ))}
            </div>
          </>
        }
        bodyClassName="flex flex-col"
      >
        <div ref={parentRef} className="min-h-0 flex-1 overflow-y-auto px-2 py-1">
          <div style={{ height: v.getTotalSize(), position: 'relative' }}>
            {v.getVirtualItems().map((it) => (
              <div key={list[it.index].id} data-index={it.index} ref={v.measureElement} style={{ position: 'absolute', top: 0, left: 0, right: 0, transform: `translateY(${it.start}px)` }}>
                <MessageRow m={list[it.index]} />
              </div>
            ))}
          </div>
        </div>
        <div className="flex gap-2 border-t hairline p-2.5">
          <Select value={to} onChange={(e) => setTo(e.target.value)} className="w-56 text-xs" aria-label="Recipient">
            <option value="">📣 Everyone (broadcast)</option>
            <optgroup label="Teams">{Object.values(teams).map((t) => <option key={t.id} value={`t:${t.id}`}># {t.name}</option>)}</optgroup>
            <optgroup label="Agents">{Object.values(agents).map((a) => <option key={a.id} value={`a:${a.id}`}>{a.name}</option>)}</optgroup>
          </Select>
          <Input value={body} onChange={(e) => setBody(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send()} placeholder="Message agents — Claude agents read new messages between turns" className="flex-1 text-sm" />
          <Button variant="primary" size="md" icon={<Send size={13} />} onClick={send}>Send</Button>
        </div>
      </Panel>
    </div>
  );
}
