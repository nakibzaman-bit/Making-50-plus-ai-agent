import { Command, Play, Pause, Radio, FlaskConical, Wifi, WifiOff } from 'lucide-react';
import clsx from 'clsx';
import { useStore } from '../../store/store';
import { act, boot } from '../../store/controller';
import { compact, duration, mb, usd } from '../../lib/format';
import { Stat, Kbd } from '../ui';
import { ProjectSwitcher } from './ProjectSwitcher';
import type { Tone } from '../../lib/status';

const healthTone = (s?: string): Tone => (s === 'passing' ? 'done' : s === 'failing' ? 'fail' : s === 'running' ? 'active' : 'idle');
const healthIcon = (s?: string) => (s === 'passing' ? '✓' : s === 'failing' ? '✕' : s === 'running' ? '…' : '–');

export function TopBar() {
  const m = useStore((s) => s.metrics);
  const project = useStore((s) => s.project);
  const mode = useStore((s) => s.mode);
  const connection = useStore((s) => s.connection);
  const running = project?.status === 'running';

  const toggleMode = (next: 'live' | 'demo') => {
    if (next === mode) return;
    useStore.getState().setMode(next);
    void boot();
  };

  return (
    <header className="relative z-20 flex h-14 shrink-0 items-center gap-3 border-b hairline bg-ink-900/70 px-3 backdrop-blur-xl">
      <div className="flex items-center gap-2 pr-1">
        <svg width="22" height="22" viewBox="0 0 32 32" aria-hidden><defs><linearGradient id="lg" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#60a5fa" /><stop offset="1" stopColor="#c084fc" /></linearGradient></defs><path d="M6 26V6l20 20V6" fill="none" stroke="url(#lg)" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" /></svg>
        <span className="text-gradient hidden text-sm font-semibold tracking-[0.28em] xl:inline">NEXUS</span>
      </div>
      <ProjectSwitcher />

      <div role="radiogroup" aria-label="Data source" className="flex h-7 items-center rounded-lg border border-white/[0.08] bg-black/30 p-0.5 text-[10px] font-bold tracking-widest">
        <button role="radio" aria-checked={mode === 'live'} onClick={() => toggleMode('live')} className={clsx('flex h-full items-center gap-1 rounded-md px-2 transition', mode === 'live' ? 'bg-emerald-500/15 text-emerald-300' : 'text-ink-400 hover:text-ink-200')}><Radio size={11} />LIVE</button>
        <button role="radio" aria-checked={mode === 'demo'} onClick={() => toggleMode('demo')} className={clsx('flex h-full items-center gap-1 rounded-md px-2 transition', mode === 'demo' ? 'bg-amber-500/15 text-amber-300' : 'text-ink-400 hover:text-ink-200')}><FlaskConical size={11} />DEMO</button>
      </div>

      {project && (
        <button
          onClick={() => void act((b) => (running ? b.halt(project.id) : b.run(project.id)))}
          className={clsx('flex h-8 items-center gap-1.5 rounded-lg px-3 text-[11px] font-bold tracking-widest transition', running ? 'bg-white/[0.06] text-ink-100 hover:bg-white/[0.1]' : 'bg-gradient-to-b from-emerald-500 to-emerald-600 text-white shadow-[0_6px_20px_-8px_rgba(16,185,129,0.8)] hover:brightness-110')}
          data-testid="run-toggle"
        >
          {running ? <Pause size={12} /> : <Play size={12} />}
          {running ? 'PAUSE' : 'RUN'}
        </button>
      )}

      <div className="mx-1 hidden h-8 w-px bg-white/[0.07] md:block" />

      <div className="flex min-w-0 flex-1 items-center gap-4 overflow-x-auto pr-2 [&>*]:shrink-0" data-testid="command-center">
        <Stat label="Active agents" value={m?.activeAgents ?? 0} tone="active" sub={`/ ${m?.totalAgents ?? 0}`} />
        <Stat label="Running" value={m?.runningTasks ?? 0} />
        <Stat label="Completed" value={m?.completedTasks ?? 0} tone="done" sub={`/ ${m?.totalTasks ?? 0}`} />
        <Stat label="Failed" value={m?.failedTasks ?? 0} tone={m?.failedTasks ? 'fail' : undefined} />
        <Stat label="Blocked" value={m?.blockedTasks ?? 0} tone={m?.blockedTasks ? 'wait' : undefined} />
        <Stat label="Review" value={m?.reviewTasks ?? 0} tone={m?.reviewTasks ? 'wait' : undefined} />
        <Stat label="Tokens" value={compact(m?.tokens ?? 0)} />
        <Stat label="Cost" value={usd(m?.costUsd ?? 0)} />
        <Stat label="CPU" value={`${Math.round(m?.cpu ?? 0)}%`} />
        <Stat label="Memory" value={mb(m?.memMb ?? 0)} />
        <Stat label="Build" value={healthIcon(m?.build)} tone={healthTone(m?.build)} />
        <Stat label="Tests" value={healthIcon(m?.tests)} tone={healthTone(m?.tests)} />
        <Stat label="Branches" value={m?.branches ?? 0} />
        <Stat label="Commits" value={m?.commits ?? 0} />
        <Stat label="Uptime" value={duration(m?.uptimeMs ?? 0)} />
      </div>

      <div className="flex items-center gap-2">
        <span title={`WebSocket ${connection}`} className={clsx('flex items-center gap-1 text-[10px]', connection === 'open' ? 'text-emerald-400' : connection === 'connecting' ? 'text-amber-400' : 'text-red-400')}>
          {connection === 'open' ? <Wifi size={13} /> : <WifiOff size={13} />}
        </span>
        <button onClick={() => useStore.setState({ paletteOpen: true })} className="flex h-8 items-center gap-2 rounded-lg border border-white/[0.08] bg-white/[0.03] px-2.5 text-xs text-ink-300 transition hover:text-white" aria-label="Open command palette">
          <Command size={13} /> <span className="hidden lg:inline">Command</span> <Kbd>Ctrl K</Kbd>
        </button>
      </div>
    </header>
  );
}
