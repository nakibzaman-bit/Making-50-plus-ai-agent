import { useEffect, useMemo, useState } from 'react';
import { GitBranch, GitCommit, GitMerge, RefreshCw } from 'lucide-react';
import clsx from 'clsx';
import type { BranchInfo, CommitInfo } from '../../shared/types';
import { useStore } from '../store/store';
import { backend } from '../store/controller';
import { mergeTone, TONE_HEX, agentTone } from '../lib/status';
import { ago } from '../lib/format';
import { IconButton, Panel, StatusDot, Empty } from '../components/ui';

export default function BranchesView() {
  const projectId = useStore((s) => s.projectId);
  const agents = useStore((s) => s.agents);
  const teams = useStore((s) => s.teams);
  const gitVersion = useStore((s) => s.gitVersion);
  const [branches, setBranches] = useState<BranchInfo[]>([]);
  const [selected, setSelected] = useState('main');
  const [commits, setCommits] = useState<CommitInfo[]>([]);

  const load = () => projectId && backend().branches(projectId).then(setBranches).catch(() => undefined);
  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, gitVersion]);
  useEffect(() => {
    if (projectId) backend().commits(projectId, selected).then(setCommits).catch(() => setCommits([]));
  }, [projectId, selected, gitVersion]);

  // MAIN → team → branch
  const groups = useMemo(() => {
    const g = new Map<string, BranchInfo[]>();
    for (const b of branches) {
      if (b.name === 'main') continue;
      const a = b.agentId ? agents[b.agentId] : undefined;
      const key = a?.teamId ? teams[a.teamId]?.name ?? 'Unassigned' : 'Unassigned';
      g.set(key, [...(g.get(key) ?? []), b]);
    }
    return [...g].sort(([a], [b]) => a.localeCompare(b));
  }, [branches, agents, teams]);

  const color = (b: BranchInfo) => {
    if (b.merged) return TONE_HEX.done;
    if (b.mergeStatus) return TONE_HEX[mergeTone(b.mergeStatus)];
    const a = b.agentId ? agents[b.agentId] : undefined;
    return a ? TONE_HEX[agentTone(a.status)] : TONE_HEX.idle;
  };

  return (
    <div className="grid h-full grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3 p-4">
      <Panel title={`Branch explorer · ${branches.length} branches`} actions={<IconButton label="Refresh" onClick={load}><RefreshCw size={13} /></IconButton>} bodyClassName="overflow-y-auto p-3">
        {!branches.length ? <Empty title="No branches yet" /> : (
          <div className="font-mono text-[12.5px]">
            <button onClick={() => setSelected('main')} className={clsx('flex w-full items-center gap-2 rounded-lg px-2 py-1.5', selected === 'main' && 'bg-white/[0.06]')}>
              <GitBranch size={14} className="text-blue-300" /><span className="font-semibold tracking-wider text-white">MAIN</span>
              <span className="ml-auto text-[10px] text-ink-400">{branches.find((b) => b.name === 'main')?.lastCommit?.message}</span>
            </button>
            {groups.map(([team, bs], gi) => (
              <div key={team} className="ml-3 border-l border-white/10 pl-3">
                <div className="flex items-center gap-2 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-300">
                  <span className="-ml-3 h-px w-3 bg-white/10" />{team}<span className="text-ink-500">{bs.length}</span>
                </div>
                {bs.map((b, i) => {
                  const a = b.agentId ? agents[b.agentId] : undefined;
                  const last = gi === groups.length - 1 && i === bs.length - 1;
                  return (
                    <button key={b.name} onClick={() => setSelected(b.name)} className={clsx('relative ml-3 flex w-[calc(100%-12px)] items-center gap-2 rounded-lg px-2 py-1 text-left transition hover:bg-white/[0.04]', selected === b.name && 'bg-white/[0.06]')} style={{ animation: 'fade-up .3s ease-out' }}>
                      <span className={clsx('absolute -left-3 top-1/2 h-px w-3 bg-white/10', last && '')} />
                      <span style={{ color: color(b) }}>●</span>
                      <span className="truncate text-ink-100">{b.name.replace('agent/', '')}</span>
                      <span className="truncate text-[10.5px] text-ink-400">{a?.name}</span>
                      <span className="ml-auto flex shrink-0 items-center gap-2 text-[10px]">
                        {b.ahead > 0 && <span className="text-emerald-300">↑{b.ahead}</span>}
                        {b.behind > 0 && <span className="text-amber-300">↓{b.behind}</span>}
                        {b.merged ? <span className="flex items-center gap-1 text-emerald-300"><GitMerge size={11} />merged</span> : b.mergeStatus ? <span style={{ color: TONE_HEX[mergeTone(b.mergeStatus)] }}>{b.mergeStatus}</span> : null}
                      </span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </Panel>
      <Panel title={<span className="normal-case tracking-normal">Commits on <span className="mono text-ink-100">{selected}</span>{selected !== 'main' && ' (ahead of main)'}</span>} bodyClassName="overflow-y-auto p-3">
        {!commits.length ? <Empty icon={<GitCommit size={22} />} title="No commits" body={selected === 'main' ? undefined : 'This branch has no commits beyond main (or they were merged).'} /> : (
          <ol className="relative ml-2 border-l border-white/10">
            {commits.map((c) => (
              <li key={c.hash} className="relative ml-4 py-2" style={{ animation: 'fade-up .25s ease-out' }}>
                <span className="absolute -left-[21px] top-3"><StatusDot tone={c.message.startsWith('merge:') ? 'done' : 'active'} size={8} /></span>
                <div className="text-[12.5px] text-ink-100">{c.message}</div>
                <div className="mono mt-0.5 text-[10.5px] text-ink-400">{c.shortHash} · {c.author} · {ago(c.date)}</div>
              </li>
            ))}
          </ol>
        )}
      </Panel>
    </div>
  );
}
