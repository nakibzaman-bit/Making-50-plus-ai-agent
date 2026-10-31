import { useShallow } from 'zustand/react/shallow';
import { useEffect, useRef, useState } from 'react';
import { ChevronUp, ChevronDown, ShieldAlert, Check, X } from 'lucide-react';
import clsx from 'clsx';
import { useStore } from '../../store/store';
import { act } from '../../store/controller';
import { clock } from '../../lib/format';
import { MessageRow } from '../../views/CommsView';

const LEVEL = { info: 'text-ink-200', success: 'text-emerald-300', warn: 'text-amber-300', error: 'text-red-300' };

export function CommsDock() {
  const [open, setOpen] = useState(true);
  const feed = useStore((s) => s.feed);
  const messages = useStore((s) => s.messages);
  const approvals = useStore(useShallow((s) => Object.values(s.approvals).filter((a) => a.status === 'pending')));
  const feedRef = useRef<HTMLDivElement>(null);
  const msgRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight });
  }, [feed.length]);
  useEffect(() => {
    msgRef.current?.scrollTo({ top: msgRef.current.scrollHeight });
  }, [messages.length]);

  return (
    <div className={clsx('z-10 shrink-0 border-t hairline bg-ink-900/70 backdrop-blur-xl transition-[height] duration-300', open ? 'h-44' : 'h-9')}>
      <div className="flex h-9 items-center gap-3 px-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-400">
        <button onClick={() => setOpen(!open)} className="flex items-center gap-1.5 hover:text-ink-100" aria-expanded={open}>
          {open ? <ChevronDown size={13} /> : <ChevronUp size={13} />} Live communications
        </button>
        <span className="text-ink-500">·</span>
        <span className="normal-case tracking-normal text-ink-300">{messages.length} messages</span>
        {approvals.length > 0 && (
          <div className="ml-auto flex items-center gap-2 normal-case tracking-normal">
            <ShieldAlert size={13} className="text-amber-400" />
            <span className="max-w-[420px] truncate text-amber-200">{approvals[0].reason}</span>
            <button className="flex items-center gap-1 rounded-md bg-emerald-500/15 px-2 py-0.5 text-emerald-300 hover:bg-emerald-500/25" onClick={() => void act((b) => b.approval(approvals[0].id, true), 'Approved')} data-testid="dock-approve"><Check size={11} />Approve</button>
            <button className="flex items-center gap-1 rounded-md bg-red-500/10 px-2 py-0.5 text-red-300 hover:bg-red-500/20" onClick={() => void act((b) => b.approval(approvals[0].id, false), 'Denied')}><X size={11} />Deny</button>
            {approvals.length > 1 && <span className="text-ink-400">+{approvals.length - 1}</span>}
          </div>
        )}
      </div>
      {open && (
        <div className="grid h-[calc(100%-36px)] grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-px bg-white/[0.04]">
          <div ref={feedRef} className="overflow-y-auto bg-ink-900/60 px-3 py-1.5 font-mono text-[11px] leading-relaxed" data-testid="orchestrator-feed">
            <div className="sticky top-0 bg-ink-900/90 pb-1 text-[9px] font-semibold uppercase tracking-[0.18em] text-violet-300/80">👑 Orchestrator</div>
            {feed.length === 0 && <div className="text-ink-400">Waiting for orchestrator activity…</div>}
            {feed.map((f) => (
              <div key={f.id} className={LEVEL[f.level]}><span className="mr-2 text-ink-500">{clock(f.at)}</span>{f.line}</div>
            ))}
          </div>
          <div ref={msgRef} className="overflow-y-auto bg-ink-900/60 px-2 py-1">
            {messages.slice(-120).map((m) => <MessageRow key={m.id} m={m} dense />)}
          </div>
        </div>
      )}
    </div>
  );
}
