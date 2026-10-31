import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, CornerDownLeft } from 'lucide-react';
import clsx from 'clsx';
import type { SearchResult } from '../../../shared/types';
import { useStore, type View } from '../../store/store';
import { act, backend, openProject } from '../../store/controller';
import { Kbd } from '../ui';

interface Cmd {
  id: string;
  label: string;
  hint?: string;
  group: string;
  run: () => void;
  keywords?: string;
}

const TYPE_ICON: Record<SearchResult['type'], string> = { agent: '🤖', task: '📋', branch: '🌿', file: '📄', commit: '●', message: '💬', error: '⛔', project: '📁' };

export function CommandPalette() {
  const open = useStore((s) => s.paletteOpen);
  const [q, setQ] = useState('');
  const [idx, setIdx] = useState(0);
  const [results, setResults] = useState<SearchResult[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        useStore.setState((s) => ({ paletteOpen: !s.paletteOpen }));
      }
      if (e.key === 'Escape') useStore.setState({ paletteOpen: false });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (open) {
      setQ('');
      setIdx(0);
      setResults([]);
      setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, [open]);

  useEffect(() => {
    if (!open || q.trim().length < 2) {
      setResults([]);
      return;
    }
    const t = setTimeout(() => {
      void backend().search(useStore.getState().projectId, q.trim()).then(setResults).catch(() => setResults([]));
    }, 160);
    return () => clearTimeout(t);
  }, [q, open]);

  const commands: Cmd[] = useMemo(() => {
    const s = useStore.getState();
    const sel = s.selectedAgentId;
    const close = () => useStore.setState({ paletteOpen: false });
    const go = (view: View) => () => { useStore.setState({ view }); close(); };
    const orch = Object.values(s.agents).find((a) => a.roleId === 'orchestrator');
    const pid = s.projectId;
    const list: Cmd[] = [
      { id: 'spawn', group: 'Agents', label: 'Spawn agent', run: () => useStore.setState({ dialog: { kind: 'spawn' }, paletteOpen: false }), keywords: 'new create add' },
      { id: 'team', group: 'Agents', label: 'Create team', run: () => useStore.setState({ dialog: { kind: 'team' }, paletteOpen: false }) },
      { id: 'task', group: 'Tasks', label: 'Create task', run: () => useStore.setState({ dialog: { kind: 'task' }, paletteOpen: false }), keywords: 'new add' },
      { id: 'focus-orch', group: 'Navigate', label: 'Focus orchestrator', run: () => { if (orch) useStore.setState({ view: 'canvas', dims: '2d', focusRequest: { agentId: orch.id, at: Date.now() }, selectedAgentId: orch.id }); close(); } },
      { id: 'arrange', group: 'Canvas', label: 'Auto-arrange workspace', run: () => { useStore.setState((x) => ({ view: 'canvas', dims: '2d', layoutRequest: x.layoutRequest + 1 })); close(); }, keywords: 'layout' },
      { id: '3d', group: 'Canvas', label: s.dims === '3d' ? 'Switch to 2D canvas' : 'Enter 3D command mode', run: () => { useStore.setState({ view: 'canvas', dims: s.dims === '3d' ? '2d' : '3d' }); close(); } },
      { id: 'run', group: 'Orchestration', label: s.project?.status === 'running' ? 'Pause orchestration' : 'Run orchestration', run: () => { if (pid) void act((b) => (s.project?.status === 'running' ? b.halt(pid) : b.run(pid))); close(); } },
      { id: 'demo', group: 'Mode', label: s.mode === 'demo' ? 'Switch to LIVE mode' : 'Switch to DEMO mode', run: () => { close(); document.querySelector<HTMLButtonElement>(`[role=radio][aria-checked=false]`)?.click(); } },
      { id: 'project', group: 'Projects', label: 'New project', run: () => useStore.setState({ dialog: { kind: 'project' }, paletteOpen: false }) },
      { id: 'lab', group: 'Projects', label: 'Open NEXUS TEST LAB', run: async () => { close(); const p = await act((b) => b.loadTestLab()); if (p) void openProject(p.id); } },
      ...(['canvas', 'tree', 'tasks', 'branches', 'merge', 'comms', 'resources', 'roles', 'settings'] as View[]).map((v) => ({ id: `go-${v}`, group: 'Navigate', label: `Go to ${v === 'merge' ? 'merge queue' : v}`, run: go(v) })),
      { id: 'search', group: 'Search', label: 'Search project…', hint: 'type 2+ characters', run: () => inputRef.current?.focus() },
    ];
    if (sel) {
      const a = s.agents[sel];
      if (a) {
        list.unshift(
          { id: 'stop', group: `Selected · ${a.name}`, label: `Stop agent ${a.name}`, run: () => { void act((b) => b.agentAction(sel, 'stop')); close(); } },
          { id: 'pause', group: `Selected · ${a.name}`, label: `Pause agent ${a.name}`, run: () => { void act((b) => b.agentAction(sel, 'pause')); close(); } },
          { id: 'term', group: `Selected · ${a.name}`, label: 'Open terminal', run: () => { useStore.setState({ inspectorTab: 'terminal' }); close(); } },
          { id: 'tests', group: `Selected · ${a.name}`, label: 'Run tests', run: () => { void act((b) => b.runTests(sel), 'Tests finished'); close(); } },
          { id: 'merge', group: `Selected · ${a.name}`, label: `Merge branch ${a.branch ?? ''}`, run: () => { void act((b) => b.agentAction(sel, 'merge'), 'Merge requested'); close(); } },
        );
      }
    }
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const ql = q.toLowerCase();
  const filtered = commands.filter((c) => !ql || `${c.label} ${c.group} ${c.keywords ?? ''}`.toLowerCase().includes(ql));
  const items: { key: string; label: string; sub: string; icon: string; run: () => void }[] = [
    ...filtered.map((c) => ({ key: c.id, label: c.label, sub: c.group, icon: '›', run: c.run })),
    ...results.map((r) => ({
      key: `${r.type}-${r.id}`,
      label: r.title,
      sub: `${r.type} · ${r.subtitle}`,
      icon: TYPE_ICON[r.type],
      run: () => {
        useStore.setState({ paletteOpen: false });
        if (r.type === 'project') void openProject(r.projectId);
        else if (r.type === 'task') useStore.setState({ view: 'tasks', selectedTaskId: r.id });
        else if (r.type === 'file' && r.agentId) useStore.setState({ selectedAgentId: r.agentId, inspectorTab: 'files', inspectorFile: r.id });
        else if (r.type === 'branch') useStore.setState({ view: 'branches', selectedAgentId: r.agentId ?? null });
        else if (r.type === 'error' && r.agentId) useStore.getState().select(r.agentId, 'terminal');
        else if (r.agentId) { useStore.getState().select(r.agentId, r.type === 'message' ? 'messages' : r.type === 'commit' ? 'git' : 'overview'); useStore.setState({ focusRequest: { agentId: r.agentId, at: Date.now() } }); }
      },
    })),
  ];

  if (!open) return null;
  const choose = (i: number) => items[i]?.run();
  return (
    <div className="fixed inset-0 z-[80] flex items-start justify-center bg-black/50 pt-[12vh] backdrop-blur-sm" onMouseDown={() => useStore.setState({ paletteOpen: false })}>
      <div className="glass-strong w-[640px] max-w-[92vw] overflow-hidden rounded-2xl" onMouseDown={(e) => e.stopPropagation()} style={{ animation: 'fade-up .16s ease-out' }} role="dialog" aria-label="Command palette">
        <div className="flex items-center gap-3 border-b hairline px-4">
          <Search size={16} className="text-ink-400" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => { setQ(e.target.value); setIdx(0); }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setIdx((i) => Math.min(items.length - 1, i + 1)); }
              if (e.key === 'ArrowUp') { e.preventDefault(); setIdx((i) => Math.max(0, i - 1)); }
              if (e.key === 'Enter') choose(idx);
            }}
            placeholder="Type a command, or search agents, tasks, branches, files, commits, messages, errors…"
            className="h-14 flex-1 bg-transparent text-[15px] text-white outline-none placeholder:text-ink-400"
            aria-label="Command or search"
          />
          <Kbd>Esc</Kbd>
        </div>
        <div className="max-h-[52vh] overflow-y-auto p-1.5">
          {!items.length && <div className="p-6 text-center text-sm text-ink-400">No matches</div>}
          {items.map((it, i) => (
            <button key={it.key} onMouseEnter={() => setIdx(i)} onClick={() => choose(i)} className={clsx('flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left', i === idx ? 'bg-blue-500/15' : 'hover:bg-white/[0.04]')}>
              <span className="w-5 text-center text-sm text-ink-300">{it.icon}</span>
              <span className="min-w-0 flex-1"><span className="block truncate text-[13.5px] text-ink-100">{it.label}</span><span className="block truncate text-[11px] text-ink-400">{it.sub}</span></span>
              {i === idx && <CornerDownLeft size={13} className="text-ink-400" />}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
