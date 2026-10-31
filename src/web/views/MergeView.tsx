import { useShallow } from 'zustand/react/shallow';
import { Check, X, RotateCcw, ShieldAlert, GitMerge, Loader2 } from 'lucide-react';
import clsx from 'clsx';
import { MERGE_STEPS, type MergeRequest } from '../../shared/types';
import { useStore } from '../store/store';
import { act } from '../store/controller';
import { mergeTone, TONE_HEX } from '../lib/status';
import { ago } from '../lib/format';
import { Button, Empty, Panel, Pill } from '../components/ui';

const STEP_LABEL: Record<string, string> = { tests: 'Tests', conflicts: 'Conflicts', lint: 'Lint', build: 'Build', integration: 'Integration', approval: 'Approval', merge: 'Merge' };

function Step({ name, check }: { name: string; check: MergeRequest['checks'][keyof MergeRequest['checks']] }) {
  const c = { pending: '#33405e', running: TONE_HEX.active, passed: TONE_HEX.done, failed: TONE_HEX.fail, skipped: '#5b6889' }[check.status];
  return (
    <div className="flex min-w-0 flex-1 flex-col items-center gap-1" title={`${STEP_LABEL[name]}: ${check.status}${check.detail ? ` — ${check.detail}` : ''}${check.durationMs ? ` (${(check.durationMs / 1000).toFixed(1)}s)` : ''}`}>
      <div className={clsx('relative grid h-6 w-6 place-items-center rounded-full text-[10px] font-bold', check.status === 'running' && 'ring-pulse')} style={{ background: `${c}26`, color: c, boxShadow: `inset 0 0 0 1.5px ${c}` }}>
        {check.status === 'passed' ? <Check size={12} /> : check.status === 'failed' ? <X size={12} /> : check.status === 'running' ? <Loader2 size={11} className="animate-spin" /> : check.status === 'skipped' ? '–' : ''}
      </div>
      <div className="text-[9px] font-semibold uppercase tracking-wider text-ink-400">{STEP_LABEL[name]}</div>
    </div>
  );
}

function MergeRow({ mr }: { mr: MergeRequest }) {
  const agent = useStore((s) => (mr.agentId ? s.agents[mr.agentId] : undefined));
  const task = useStore((s) => (mr.taskId ? s.tasks[mr.taskId] : undefined));
  const tone = mergeTone(mr.status);
  const summary = mr.status === 'merged' ? '✓ merged' : mr.status === 'awaiting_approval' ? '⚠ review needed' : mr.status === 'conflict' ? '✕ conflicts' : mr.status === 'failed' ? `✕ ${mr.error ?? 'failed'}` : mr.status === 'rejected' ? '✕ rejected' : mr.status;
  return (
    <div className={clsx('rounded-2xl border p-3 transition', mr.status === 'awaiting_approval' ? 'border-amber-400/40 bg-amber-500/[0.05]' : 'border-white/[0.07] bg-white/[0.02]')} style={{ animation: 'fade-up .25s ease-out' }}>
      <div className="flex items-center gap-3">
        <GitMerge size={16} style={{ color: TONE_HEX[tone] }} className={clsx(mr.status === 'merging' && 'animate-pulse')} />
        <div className="min-w-0 flex-1">
          <div className="mono truncate text-[13px] text-white">{mr.branch}</div>
          <div className="truncate text-[11px] text-ink-400">{agent?.name ?? 'unknown agent'}{task ? ` · ${task.title}` : ''} · {ago(mr.updatedAt)}</div>
        </div>
        <Pill tone={tone} pulse={['checking', 'merging'].includes(mr.status)}>{summary.toUpperCase().slice(0, 40)}</Pill>
        {mr.status === 'awaiting_approval' && (
          <>
            <Button variant="success" icon={<Check size={12} />} onClick={() => void act((b) => b.mergeAction(mr.id, 'approve'), 'Merge approved')} data-testid="approve-merge">Approve</Button>
            <Button variant="danger" icon={<X size={12} />} onClick={() => void act((b) => b.mergeAction(mr.id, 'reject'), 'Merge rejected')}>Reject</Button>
          </>
        )}
        {['failed', 'conflict', 'rejected'].includes(mr.status) && <Button icon={<RotateCcw size={12} />} onClick={() => void act((b) => b.mergeAction(mr.id, 'retry'), 'Merge re-queued')}>Retry</Button>}
      </div>
      <div className="mt-3 flex items-start gap-1">
        {MERGE_STEPS.map((s, i) => (
          <div key={s} className="flex min-w-0 flex-1 items-start">
            <Step name={s} check={mr.checks[s]} />
            {i < MERGE_STEPS.length - 1 && <div className="mt-3 h-px flex-1" style={{ background: mr.checks[s].status === 'passed' || mr.checks[s].status === 'skipped' ? `${TONE_HEX.done}66` : '#ffffff14' }} />}
          </div>
        ))}
      </div>
      {mr.conflictFiles.length > 0 && <div className="mono mt-2 text-[11px] text-red-300">Conflicts: {mr.conflictFiles.join(', ')}</div>}
      {mr.mergedCommit && <div className="mono mt-2 text-[11px] text-emerald-300/80">merged at {mr.mergedCommit.slice(0, 7)}</div>}
    </div>
  );
}

export default function MergeView() {
  const merges = useStore(useShallow((s) => Object.values(s.merges).sort((a, b) => b.updatedAt - a.updatedAt)));
  const approvals = useStore(useShallow((s) => Object.values(s.approvals).filter((a) => a.status === 'pending' && a.kind !== 'merge')));
  const active = merges.filter((m) => !['merged'].includes(m.status));
  const done = merges.filter((m) => m.status === 'merged');
  return (
    <div className="grid h-full grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] gap-3 p-4">
      <Panel title={`Merge queue · ${active.length} open`} bodyClassName="space-y-2.5 overflow-y-auto p-3">
        {!active.length && <Empty icon={<GitMerge size={22} />} title="Queue is clear" body="Agents enqueue their branch when a task passes verification. Each merge runs tests → conflicts → lint → build → integration → approval → merge." />}
        {active.map((m) => <MergeRow key={m.id} mr={m} />)}
        {done.length > 0 && <div className="pt-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-400">Merged · {done.length}</div>}
        {done.slice(0, 40).map((m) => <MergeRow key={m.id} mr={m} />)}
      </Panel>
      <Panel title={`Command approvals · ${approvals.length}`} bodyClassName="space-y-2 overflow-y-auto p-3">
        {!approvals.length && <Empty icon={<ShieldAlert size={22} />} title="Nothing waiting" body="Destructive commands (rm -r, git reset --hard, git clean…) pause the agent here until you decide." />}
        {approvals.map((a) => (
          <div key={a.id} className="rounded-xl border border-amber-400/30 bg-amber-500/[0.05] p-3">
            <div className="text-[12.5px] text-amber-100">{a.reason}</div>
            <div className="mt-1 text-[11px] text-ink-400">{useStore.getState().agents[a.agentId ?? '']?.name ?? 'agent'} · {ago(a.createdAt)}</div>
            <div className="mt-2 flex gap-2">
              <Button variant="success" icon={<Check size={12} />} onClick={() => void act((b) => b.approval(a.id, true), 'Approved')}>Approve</Button>
              <Button variant="danger" icon={<X size={12} />} onClick={() => void act((b) => b.approval(a.id, false), 'Denied')}>Deny</Button>
            </div>
          </div>
        ))}
      </Panel>
    </div>
  );
}
