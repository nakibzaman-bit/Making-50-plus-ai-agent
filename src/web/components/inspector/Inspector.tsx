import { useShallow } from 'zustand/react/shallow';
import { useEffect, useMemo, useRef, useState } from 'react';
import { X, Pause, Play, Square, RotateCcw, Bug, FlaskConical, GitMerge, Trash2, Terminal, FileCode2, GitBranch, ListTodo, MessagesSquare, Activity, ScrollText, LayoutDashboard, Send, Crosshair, Undo2, Check, MessageSquareWarning } from 'lucide-react';
import clsx from 'clsx';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { AgentGitState, FileChange } from '../../../shared/types';
import { modelLabel } from '../../../shared/pricing';
import { useStore, type InspectorTab } from '../../store/store';
import { act, backend } from '../../store/controller';
import { agentTone, AGENT_STATUS_LABEL, taskTone } from '../../lib/status';
import { ago, clock, compact, duration, mb, usd } from '../../lib/format';
import { Badge, Button, Empty, Input, Pill, Select, Sparkline, Tabs, Textarea } from '../ui';
import { MessageRow } from '../../views/CommsView';

const STREAM_CLS: Record<string, string> = { stdout: 'text-ink-100', stderr: 'text-red-300', system: 'text-sky-300', cmd: 'text-emerald-300 font-semibold', agent: 'text-violet-200' };

function TerminalTab({ agentId }: { agentId: string }) {
  const lines = useStore((s) => s.logs[agentId]);
  const [filter, setFilter] = useState('');
  const [follow, setFollow] = useState(true);
  const list = useMemo(() => (lines ?? []).filter((l) => !filter || l.line.toLowerCase().includes(filter.toLowerCase())), [lines, filter]);
  const ref = useRef<HTMLDivElement>(null);
  const v = useVirtualizer({ count: list.length, getScrollElement: () => ref.current, estimateSize: () => 17, overscan: 30 });
  useEffect(() => {
    void backend().agentLogs(agentId).then((l) => useStore.getState().mergeLogs(agentId, l)).catch(() => undefined);
  }, [agentId]);
  useEffect(() => {
    if (follow && list.length) v.scrollToIndex(list.length - 1, { align: 'end' });
  }, [list.length, follow, v]);
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 px-3 pb-2">
        <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter output…" className="h-7 py-1 text-xs" />
        <label className="flex shrink-0 items-center gap-1 text-[11px] text-ink-300"><input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} /> follow</label>
      </div>
      <div ref={ref} className="mx-3 mb-3 min-h-0 flex-1 overflow-auto rounded-xl border border-white/[0.06] bg-[#04060b] p-2 font-mono text-[11.5px] leading-[17px]" data-testid="terminal">
        {!list.length && <div className="text-ink-500">No output yet. Logs here come from this agent's real processes.</div>}
        <div style={{ height: v.getTotalSize(), position: 'relative' }}>
          {v.getVirtualItems().map((it) => {
            const l = list[it.index];
            return (
              <div key={l.id} className={clsx('absolute left-0 right-0 whitespace-pre', STREAM_CLS[l.stream])} style={{ transform: `translateY(${it.start}px)` }}>
                <span className="mr-2 select-none text-ink-600">{clock(l.createdAt)}</span>{l.line}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function DiffView({ diff }: { diff: string }) {
  if (!diff.trim()) return <div className="p-3 text-xs text-ink-400">No differences against main.</div>;
  return (
    <pre className="mono overflow-auto text-[11.5px] leading-[18px]">
      {diff.split('\n').map((l, i) => (
        <div key={i} className={clsx('px-3', l.startsWith('+') && !l.startsWith('+++') ? 'bg-emerald-500/[0.09] text-emerald-200' : l.startsWith('-') && !l.startsWith('---') ? 'bg-red-500/[0.09] text-red-200' : l.startsWith('@@') ? 'text-sky-300' : 'text-ink-300')}>{l || ' '}</div>
      ))}
    </pre>
  );
}

function CodeViewer({ agentId, file, onClose }: { agentId: string; file: string; onClose: () => void }) {
  const [tab, setTab] = useState<'diff' | 'current' | 'previous'>('diff');
  const [diff, setDiff] = useState('');
  const [cur, setCur] = useState<string | null>(null);
  const [prev, setPrev] = useState<string | null>(null);
  const [feedback, setFeedback] = useState('');
  const [asking, setAsking] = useState(false);
  const gitVersion = useStore((s) => s.gitVersion);
  const task = useStore((s) => Object.values(s.tasks).filter((t) => t.assignedAgentId === agentId).sort((a, b) => b.updatedAt - a.updatedAt)[0]);
  useEffect(() => {
    void backend().agentDiff(agentId, file).then((d) => setDiff(d.diff)).catch(() => setDiff(''));
    void backend().agentFile(agentId, file, 'current').then((d) => setCur(d.content)).catch(() => setCur(null));
    void backend().agentFile(agentId, file, 'base').then((d) => setPrev(d.content)).catch(() => setPrev(null));
  }, [agentId, file, gitVersion]);
  const adds = diff.split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++')).length;
  const dels = diff.split('\n').filter((l) => l.startsWith('-') && !l.startsWith('---')).length;
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 px-3 pb-2">
        <button onClick={onClose} className="text-[11px] text-ink-400 hover:text-white">← files</button>
        <span className="mono min-w-0 flex-1 truncate text-[12px] text-white">{file}</span>
        <span className="mono text-[11px] text-emerald-300">+{adds}</span>
        <span className="mono text-[11px] text-red-300">-{dels}</span>
      </div>
      <div className="px-3 pb-2"><Tabs value={tab} onChange={setTab} items={[{ id: 'diff', label: 'View diff' }, { id: 'current', label: 'Current' }, { id: 'previous', label: 'Previous (main)' }]} /></div>
      <div className="mx-3 min-h-0 flex-1 overflow-auto rounded-xl border border-white/[0.06] bg-[#04060b]">
        {tab === 'diff' ? <DiffView diff={diff} /> : (
          <pre className="mono p-3 text-[11.5px] leading-[18px] text-ink-100">{(tab === 'current' ? cur : prev) ?? (tab === 'previous' ? '(file does not exist on main)' : '(file deleted)')}</pre>
        )}
      </div>
      {asking && (
        <div className="mx-3 mt-2 space-y-2">
          <Textarea rows={3} value={feedback} onChange={(e) => setFeedback(e.target.value)} placeholder="What should change? The task is re-queued with this feedback." />
          <div className="flex gap-2">
            <Button variant="warn" disabled={!task || !feedback.trim()} onClick={async () => { if (task && (await act((b) => b.requestChanges(task.id, feedback), 'Changes requested'))) { setAsking(false); setFeedback(''); } }}>Send request</Button>
            <Button variant="ghost" onClick={() => setAsking(false)}>Cancel</Button>
          </div>
        </div>
      )}
      <div className="flex flex-wrap gap-1.5 p-3">
        <Button icon={<Undo2 size={12} />} onClick={() => confirm(`Revert ${file} to its version on main and commit?`) && void act((b) => b.revertFile(agentId, file), 'File reverted')}>Revert</Button>
        <Button variant="success" icon={<Check size={12} />} onClick={() => void act((b) => b.agentAction(agentId, 'merge'), 'Approved — branch queued for merge')}>Approve</Button>
        <Button variant="warn" icon={<MessageSquareWarning size={12} />} onClick={() => setAsking(true)} disabled={!task}>Request changes</Button>
        <Button variant="primary" icon={<GitMerge size={12} />} onClick={() => void act((b) => b.agentAction(agentId, 'merge'), 'Merge requested')}>Merge</Button>
      </div>
    </div>
  );
}

function ChangeRow({ c, onOpen }: { c: FileChange; onOpen: () => void }) {
  const color = { added: '#22c55e', untracked: '#22c55e', modified: '#eab308', deleted: '#ef4444', renamed: '#60a5fa' }[c.status];
  return (
    <button onClick={onOpen} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-white/[0.05]">
      <span className="w-4 text-center text-[10px] font-bold" style={{ color }}>{c.status[0].toUpperCase()}</span>
      <span className="mono min-w-0 flex-1 truncate text-[12px] text-ink-100">{c.path}</span>
      {!c.committed && <Badge color="#eab308">uncommitted</Badge>}
      <span className="mono text-[10.5px] text-emerald-300">+{c.additions}</span>
      <span className="mono text-[10.5px] text-red-300">-{c.deletions}</span>
    </button>
  );
}

function useGit(agentId: string) {
  const [git, setGit] = useState<AgentGitState | null>(null);
  const gitVersion = useStore((s) => s.gitVersion);
  const status = useStore((s) => s.agents[agentId]?.status);
  useEffect(() => {
    const t = setTimeout(() => void backend().agentGit(agentId).then(setGit).catch(() => setGit(null)), 150);
    return () => clearTimeout(t);
  }, [agentId, gitVersion, status]);
  return git;
}

function FilesTab({ agentId }: { agentId: string }) {
  const git = useGit(agentId);
  const file = useStore((s) => s.inspectorFile);
  const [all, setAll] = useState<string[] | null>(null);
  if (file) return <CodeViewer agentId={agentId} file={file} onClose={() => useStore.setState({ inspectorFile: null })} />;
  const open = (p: string) => useStore.setState({ inspectorFile: p });
  const changes = [...(git?.uncommitted ?? []), ...(git?.changes ?? []).filter((c) => !git?.uncommitted.some((u) => u.path === c.path))];
  return (
    <div className="h-full overflow-y-auto px-3 pb-3">
      <div className="mb-1.5 flex items-center justify-between text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-400">
        <span>Changed vs main · {changes.length}</span>
        <button className="normal-case tracking-normal text-blue-300 hover:text-blue-200" onClick={() => void backend().agentFiles(agentId).then(setAll)}>{all ? 'refresh tree' : 'browse all files'}</button>
      </div>
      {!changes.length && <div className="py-3 text-xs text-ink-400">No changes on this branch yet.</div>}
      {changes.map((c) => <ChangeRow key={c.path + c.committed} c={c} onOpen={() => open(c.path)} />)}
      {all && (
        <>
          <div className="mb-1 mt-4 text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-400">Workspace · {all.length} files</div>
          {all.map((f) => <button key={f} onClick={() => open(f)} className="mono block w-full truncate rounded px-2 py-0.5 text-left text-[11.5px] text-ink-300 hover:bg-white/[0.05] hover:text-white">{f}</button>)}
        </>
      )}
    </div>
  );
}

function GitTab({ agentId }: { agentId: string }) {
  const git = useGit(agentId);
  if (!git) return <Empty title="Loading git state…" />;
  return (
    <div className="h-full space-y-4 overflow-y-auto px-3 pb-3 text-[12px]">
      <div className="grid grid-cols-2 gap-2">
        {[['Branch', git.branch ?? 'none (read-only)'], ['Base', git.base], ['Workspace', git.workspacePath ?? '—'], ['Merge status', git.mergeStatus ?? 'not requested'], ['Commits ahead', git.commits.length], ['Uncommitted files', git.uncommitted.length]].map(([k, v]) => (
          <div key={String(k)} className="min-w-0"><div className="text-[10px] uppercase tracking-wider text-ink-400">{k}</div><div className="mono truncate text-ink-100" title={String(v)}>{v}</div></div>
        ))}
      </div>
      <div>
        <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-400">Commit history</div>
        {!git.commits.length && <div className="text-xs text-ink-400">No commits ahead of main.</div>}
        <ol className="relative ml-1.5 border-l border-white/10">
          {git.commits.map((c) => (
            <li key={c.hash} className="relative ml-3 py-1.5">
              <span className="absolute -left-[17px] top-3 h-2 w-2 rounded-full bg-blue-400 shadow-[0_0_8px_#60a5fa]" />
              <div className="text-ink-100">{c.message}</div>
              <div className="mono text-[10.5px] text-ink-400">{c.shortHash} · {ago(c.date)}</div>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

function TasksTab({ agentId }: { agentId: string }) {
  const tasks = useStore(useShallow((s) => Object.values(s.tasks).filter((t) => t.assignedAgentId === agentId)));
  if (!tasks.length) return <Empty title="No tasks assigned" action={<Button onClick={() => useStore.setState({ dialog: { kind: 'task', preset: { assignedAgentId: agentId } } })}>Assign a task</Button>} />;
  return (
    <div className="h-full space-y-1.5 overflow-y-auto px-3 pb-3">
      {tasks.map((t) => (
        <button key={t.id} onClick={() => useStore.setState({ view: 'tasks', selectedTaskId: t.id })} className="w-full rounded-xl border border-white/[0.07] bg-white/[0.02] p-2.5 text-left hover:border-white/15">
          <div className="flex items-center gap-2"><span className="flex-1 truncate text-[12.5px] text-ink-100">{t.title}</span><Pill tone={taskTone(t.status)}>{t.status.toUpperCase()}</Pill></div>
          {t.error && t.status !== 'completed' && <div className="mt-1 line-clamp-2 text-[11px] text-red-300">{t.error}</div>}
          {t.result && <div className="mt-1 line-clamp-2 text-[11px] text-emerald-300/80">{t.result}</div>}
        </button>
      ))}
    </div>
  );
}

function MessagesTab({ agentId }: { agentId: string }) {
  const all = useStore((s) => s.messages);
  const teamId = useStore((s) => s.agents[agentId]?.teamId);
  const projectId = useStore((s) => s.projectId);
  const msgs = useMemo(() => all.filter((m) => m.fromAgentId === agentId || m.toAgentId === agentId || (m.kind === 'team' && m.teamId === teamId) || m.kind === 'broadcast'), [all, agentId, teamId]);
  const [body, setBody] = useState('');
  const send = () => {
    if (!projectId || !body.trim()) return;
    void act((b) => b.sendMessage(projectId, { body: body.trim(), toAgentId: agentId }));
    setBody('');
  };
  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-2">{msgs.length ? msgs.map((m) => <MessageRow key={m.id} m={m} dense />) : <Empty title="No messages yet" />}</div>
      <div className="flex gap-2 p-3">
        <Input value={body} onChange={(e) => setBody(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send()} placeholder="Message this agent…" className="text-sm" />
        <Button variant="primary" onClick={send} icon={<Send size={12} />} />
      </div>
    </div>
  );
}

function MetricsTab({ agentId }: { agentId: string }) {
  const a = useStore((s) => s.agents[agentId]);
  const hist = useStore((s) => s.agentHistory[agentId] ?? []);
  if (!a) return null;
  const tokens = a.tokensIn + a.tokensOut;
  return (
    <div className="h-full space-y-4 overflow-y-auto px-3 pb-3">
      <div><div className="mb-1 flex justify-between text-[10px] uppercase tracking-wider text-ink-400"><span>CPU</span><span className="mono">{a.cpu.toFixed(0)}%</span></div><Sparkline values={hist.map((h) => h.cpu)} color="#60a5fa" height={44} /></div>
      <div><div className="mb-1 flex justify-between text-[10px] uppercase tracking-wider text-ink-400"><span>Memory</span><span className="mono">{mb(a.memMb)}</span></div><Sparkline values={hist.map((h) => h.mem)} color="#a78bfa" height={44} /></div>
      <div><div className="mb-1 flex justify-between text-[10px] uppercase tracking-wider text-ink-400"><span>Tokens</span><span className="mono">{compact(tokens)}</span></div><Sparkline values={hist.map((h) => h.tokens)} color="#f472b6" height={44} /></div>
      <div className="grid grid-cols-2 gap-3 text-[12px]">
        {[['Input tokens', a.tokensIn.toLocaleString()], ['Output tokens', a.tokensOut.toLocaleString()], ['Remaining budget', a.tokenBudget ? Math.max(0, a.tokenBudget - tokens).toLocaleString() : '∞'], ['Cost', usd(a.costUsd)], ['Runtime', duration(a.runtimeMs)], ['Commits', a.commits], ['Files changed', a.filesChanged], ['Tests', `${a.testsPassed} ✓ / ${a.testsFailed} ✗`], ['Retries', a.retries], ['Started', a.startedAt ? ago(a.startedAt) : '—']].map(([k, v]) => (
          <div key={String(k)}><div className="text-[10px] uppercase tracking-wider text-ink-400">{k}</div><div className="mono text-ink-100">{v}</div></div>
        ))}
      </div>
    </div>
  );
}

function PromptTab({ agentId }: { agentId: string }) {
  const a = useStore((s) => s.agents[agentId]);
  const role = useStore((s) => s.roles.find((r) => r.id === a?.roleId));
  if (!a || !role) return null;
  return (
    <div className="h-full space-y-3 overflow-y-auto px-3 pb-3 text-[12px]">
      <div><div className="mb-1 text-[10px] uppercase tracking-wider text-ink-400">System prompt</div><pre className="mono whitespace-pre-wrap rounded-xl bg-black/30 p-3 text-[11px] text-ink-200">{role.systemPrompt}</pre></div>
      <div><div className="mb-1 text-[10px] uppercase tracking-wider text-ink-400">Tools</div><div className="flex flex-wrap gap-1">{role.tools.map((t) => <Badge key={t}>{t}</Badge>)}</div></div>
      <div><div className="mb-1 text-[10px] uppercase tracking-wider text-ink-400">Permissions</div><div className="flex flex-wrap gap-1">{role.permissions.map((t) => <Badge key={t} color="#60a5fa">{t}</Badge>)}</div></div>
      <div className="grid grid-cols-2 gap-2">
        {[['Command timeout', `${role.limits.commandTimeoutSec}s`], ['Memory limit', `${role.limits.maxMemoryMb} MB`], ['Max iterations', role.limits.maxIterations], ['Token budget', a.tokenBudget.toLocaleString()]].map(([k, v]) => (
          <div key={String(k)}><div className="text-[10px] uppercase tracking-wider text-ink-400">{k}</div><div className="mono text-ink-100">{v}</div></div>
        ))}
      </div>
    </div>
  );
}

function OverviewTab({ agentId }: { agentId: string }) {
  const a = useStore((s) => s.agents[agentId]);
  const agents = useStore((s) => s.agents);
  const teams = useStore((s) => s.teams);
  const task = useStore((s) => (a?.currentTaskId ? s.tasks[a.currentTaskId] : undefined));
  const failedTask = useStore((s) => Object.values(s.tasks).filter((t) => t.assignedAgentId === agentId && t.status === 'failed').sort((x, y) => y.updatedAt - x.updatedAt)[0]);
  const [reassign, setReassign] = useState('');
  if (!a) return null;
  const busy = ['working', 'communicating', 'waiting'].includes(a.status);
  const A = (x: 'pause' | 'resume' | 'stop' | 'retry' | 'debug' | 'merge', msg?: string) => () => void act((b) => b.agentAction(a.id, x), msg);
  return (
    <div className="h-full space-y-4 overflow-y-auto px-3 pb-3 text-[12px]">
      {a.status === 'failed' && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/[0.07] p-3" style={{ animation: 'fade-up .25s ease-out' }}>
          <div className="text-[13px] font-semibold text-red-200">❌ Agent failed</div>
          <div className="mt-1 text-[11px] uppercase tracking-wider text-red-300/70">Reason</div>
          <div className="mono mt-0.5 whitespace-pre-wrap text-[11.5px] text-red-100">{failedTask?.error ?? a.statusReason}</div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            <Button variant="warn" icon={<RotateCcw size={12} />} onClick={A('retry', 'Retrying')}>Retry</Button>
            {failedTask && (
              <span className="flex gap-1">
                <Select value={reassign} onChange={(e) => setReassign(e.target.value)} className="h-7 w-36 py-0 text-[11px]" aria-label="Reassign to"><option value="">Reassign to…</option>{Object.values(agents).filter((x) => x.id !== a.id).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select>
                <Button disabled={!reassign} onClick={() => { void act((b) => b.reassignTask(failedTask.id, reassign), 'Task reassigned'); setReassign(''); }}>Reassign</Button>
              </span>
            )}
            <Button icon={<Terminal size={12} />} onClick={() => useStore.setState({ inspectorTab: 'terminal' })}>View logs</Button>
            <Button variant="danger" icon={<Bug size={12} />} onClick={A('debug', 'Debugger spawned')}>Spawn debugger</Button>
            <Button icon={<Square size={11} />} onClick={A('stop')}>Stop</Button>
          </div>
        </div>
      )}
      <div>
        <div className="mb-1 text-[10px] uppercase tracking-wider text-ink-400">Current task</div>
        <div className="rounded-xl bg-white/[0.03] p-2.5 text-ink-100">{task ? <><div className="font-medium">{task.title}</div><div className="mt-0.5 line-clamp-3 text-[11.5px] text-ink-300">{task.description}</div></> : <span className="text-ink-400">{a.statusReason ?? 'Idle'}</span>}</div>
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-2.5">
        {[
          ['Model', modelLabel(a.model)],
          ['Runtime', a.runtime],
          ['Branch', a.branch ?? '—'],
          ['Workspace', a.workspacePath ?? '—'],
          ['Team', a.teamId ? teams[a.teamId]?.name : '—'],
          ['Reports to', a.parentId ? agents[a.parentId]?.name : '—'],
          ['CPU', `${a.cpu.toFixed(0)}%`],
          ['Memory', mb(a.memMb)],
          ['Tokens', compact(a.tokensIn + a.tokensOut)],
          ['Cost', usd(a.costUsd)],
          ['Runtime', duration(a.runtimeMs)],
          ['Tests', `${a.testsPassed} ✓ / ${a.testsFailed} ✗`],
        ].map(([k, v]) => (
          <div key={String(k)} className="min-w-0"><div className="text-[10px] uppercase tracking-wider text-ink-400">{k}</div><div className="mono truncate text-ink-100" title={String(v)}>{v}</div></div>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <span className="text-[10px] uppercase tracking-wider text-ink-400">Priority</span>
        <input type="range" min={0} max={10} value={a.priority} onChange={(e) => void act((b) => b.updateAgent(a.id, { priority: Number(e.target.value) }))} className="flex-1 accent-blue-500" aria-label="Agent priority" />
        <span className="mono w-6 text-ink-100">{a.priority}</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {a.status === 'paused' || a.status === 'stopped' ? <Button variant="success" icon={<Play size={12} />} onClick={A('resume')}>Resume</Button> : <Button icon={<Pause size={12} />} disabled={!busy} onClick={A('pause')}>Pause</Button>}
        <Button icon={<Square size={11} />} disabled={a.status === 'stopped'} onClick={A('stop')}>Stop</Button>
        <Button icon={<FlaskConical size={12} />} disabled={busy || !a.branch} onClick={() => void act((b) => b.runTests(a.id)).then((r) => r && useStore.getState().toast({ tone: r.ok ? 'success' : 'error', title: `Tests ${r.ok ? 'passed' : 'failed'}`, body: `${r.passed} passed · ${r.failed} failed — ${r.command}` }))}>Run tests</Button>
        <Button icon={<GitMerge size={12} />} disabled={!a.branch} onClick={A('merge', 'Merge requested')}>Merge branch</Button>
        <Button icon={<Bug size={12} />} onClick={A('debug', 'Debugger spawned')}>Debug</Button>
        <Button variant="danger" icon={<Trash2 size={12} />} onClick={() => confirm(`Remove ${a.name}? Its worktree is deleted; the branch is kept.`) && void act((b) => b.deleteAgent(a.id), 'Agent removed')}>Remove</Button>
      </div>
    </div>
  );
}

const TABS: { id: InspectorTab; label: string; icon: React.ReactNode }[] = [
  { id: 'overview', label: 'Overview', icon: <LayoutDashboard size={12} /> },
  { id: 'terminal', label: 'Terminal', icon: <Terminal size={12} /> },
  { id: 'files', label: 'Files', icon: <FileCode2 size={12} /> },
  { id: 'git', label: 'Git', icon: <GitBranch size={12} /> },
  { id: 'tasks', label: 'Tasks', icon: <ListTodo size={12} /> },
  { id: 'messages', label: 'Messages', icon: <MessagesSquare size={12} /> },
  { id: 'metrics', label: 'Metrics', icon: <Activity size={12} /> },
  { id: 'prompt', label: 'Prompt', icon: <ScrollText size={12} /> },
];

export function Inspector() {
  const id = useStore((s) => s.selectedAgentId);
  const a = useStore((s) => (id ? s.agents[id] : undefined));
  const role = useStore((s) => s.roles.find((r) => r.id === a?.roleId));
  const tab = useStore((s) => s.inspectorTab);
  if (!id || !a) return null;
  const tone = agentTone(a.status);
  return (
    <aside className="glass-strong z-20 flex w-[440px] shrink-0 flex-col border-l hairline" style={{ animation: 'fade-up .2s ease-out' }} data-testid="inspector" aria-label={`Agent ${a.name}`}>
      <div className="flex items-start gap-3 p-4 pb-3">
        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl text-2xl" style={{ background: `${role?.color ?? '#60a5fa'}22`, boxShadow: `inset 0 0 0 1px ${role?.color ?? '#60a5fa'}44` }}>{role?.icon ?? '🤖'}</div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-semibold text-white">{a.name}</div>
          <div className="truncate text-[11.5px] text-ink-400">{role?.name} · <span className="mono">{a.id}</span></div>
          <div className="mt-1.5"><Pill tone={tone} pulse={a.status === 'working'}>{AGENT_STATUS_LABEL[a.status]}</Pill></div>
        </div>
        <button aria-label="Focus on canvas" title="Focus on canvas" onClick={() => useStore.setState({ view: 'canvas', dims: '2d', focusRequest: { agentId: a.id, at: Date.now() } })} className="text-ink-400 hover:text-white"><Crosshair size={15} /></button>
        <button aria-label="Close inspector" onClick={() => useStore.getState().select(null)} className="text-ink-400 hover:text-white"><X size={16} /></button>
      </div>
      <div className="px-3 pb-3"><Tabs wrap value={tab} onChange={(t) => useStore.setState({ inspectorTab: t, inspectorFile: null })} items={TABS} /></div>
      <div className="min-h-0 flex-1">
        {tab === 'overview' && <OverviewTab agentId={id} />}
        {tab === 'terminal' && <TerminalTab agentId={id} />}
        {tab === 'files' && <FilesTab agentId={id} />}
        {tab === 'git' && <GitTab agentId={id} />}
        {tab === 'tasks' && <TasksTab agentId={id} />}
        {tab === 'messages' && <MessagesTab agentId={id} />}
        {tab === 'metrics' && <MetricsTab agentId={id} />}
        {tab === 'prompt' && <PromptTab agentId={id} />}
      </div>
    </aside>
  );
}
