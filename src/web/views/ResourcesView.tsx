import { useEffect, useState } from 'react';
import { useStore } from '../store/store';
import { act } from '../store/controller';
import { compact, mb, usd } from '../lib/format';
import { Button, Field, Input, Meter, Panel, Sparkline, Stat } from '../components/ui';

export default function ResourcesView() {
  const r = useStore((s) => s.resources);
  const hist = useStore((s) => s.resourceHistory);
  const project = useStore((s) => s.project);
  const agents = useStore((s) => s.agents);
  const [limits, setLimits] = useState({ maxAgents: 100, maxConcurrentTasks: 8, maxCpuPercent: 400, maxMemoryMb: 8192 });
  useEffect(() => {
    if (project) setLimits({ maxAgents: project.settings.maxAgents, maxConcurrentTasks: project.settings.maxConcurrentTasks, maxCpuPercent: project.settings.maxCpuPercent, maxMemoryMb: project.settings.maxMemoryMb });
  }, [project]);
  if (!project) return null;
  const s = project.settings;
  const live = Object.values(agents).filter((a) => a.status !== 'stopped').length;
  const top = Object.values(agents).filter((a) => a.cpu > 0 || a.memMb > 0).sort((a, b) => b.cpu - a.cpu).slice(0, 12);
  const byModel = new Map<string, { tokens: number; cost: number; n: number }>();
  for (const a of Object.values(agents)) {
    const m = byModel.get(a.model) ?? { tokens: 0, cost: 0, n: 0 };
    m.tokens += a.tokensIn + a.tokensOut;
    m.cost += a.costUsd;
    m.n++;
    byModel.set(a.model, m);
  }
  return (
    <div className="grid h-full grid-cols-3 grid-rows-[auto_minmax(0,1fr)] gap-3 overflow-y-auto p-4">
      <Panel title="Host CPU" bodyClassName="p-4 space-y-3">
        <Stat label="Host CPU" value={`${(r?.hostCpuPercent ?? 0).toFixed(0)}%`} />
        <Sparkline values={hist.map((h) => h.hostCpuPercent)} max={100} color="#60a5fa" />
        <Meter label={`Agent processes · ${(r?.agentCpuPercent ?? 0).toFixed(0)}% of ${s.maxCpuPercent}% cap`} value={r?.agentCpuPercent ?? 0} max={s.maxCpuPercent} color="#60a5fa" />
      </Panel>
      <Panel title="Memory" bodyClassName="p-4 space-y-3">
        <Stat label="Host RAM" value={mb(r?.hostMemUsedMb ?? 0)} sub={`/ ${mb(r?.hostMemTotalMb ?? 0)}`} />
        <Sparkline values={hist.map((h) => h.agentMemMb)} color="#a78bfa" />
        <Meter label={`Agent RSS · ${mb(r?.agentMemMb ?? 0)} of ${mb(s.maxMemoryMb)} cap`} value={r?.agentMemMb ?? 0} max={s.maxMemoryMb} color="#a78bfa" />
      </Panel>
      <Panel title="Concurrency & queue" bodyClassName="p-4 space-y-3">
        <div className="grid grid-cols-3 gap-3">
          <Stat label="Agents" value={live} sub={`/ ${s.maxAgents}`} />
          <Stat label="Running" value={r?.runningTasks ?? 0} sub={`/ ${s.maxConcurrentTasks}`} tone="active" />
          <Stat label="Queued" value={r?.queuedTasks ?? 0} tone={r?.queuedTasks ? 'wait' : undefined} />
        </div>
        <Sparkline values={hist.map((h) => h.runningTasks)} max={s.maxConcurrentTasks} color="#22c55e" />
        <Meter label="Slots in use" value={r?.runningTasks ?? 0} max={s.maxConcurrentTasks} color="#22c55e" />
        <div className="text-[11px] text-ink-400">{r?.runningProcesses ?? 0} live processes · tasks queue automatically when slots, CPU or memory run out.</div>
      </Panel>
      <Panel title="Limits" bodyClassName="p-4 space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Max agents"><Input type="number" min={1} value={limits.maxAgents} onChange={(e) => setLimits({ ...limits, maxAgents: Number(e.target.value) })} /></Field>
          <Field label="Max concurrent tasks"><Input type="number" min={1} value={limits.maxConcurrentTasks} onChange={(e) => setLimits({ ...limits, maxConcurrentTasks: Number(e.target.value) })} /></Field>
          <Field label="Max CPU %" hint="100 = one core"><Input type="number" min={10} value={limits.maxCpuPercent} onChange={(e) => setLimits({ ...limits, maxCpuPercent: Number(e.target.value) })} /></Field>
          <Field label="Max memory (MB)"><Input type="number" min={128} value={limits.maxMemoryMb} onChange={(e) => setLimits({ ...limits, maxMemoryMb: Number(e.target.value) })} /></Field>
        </div>
        <Button variant="primary" onClick={() => void act((b) => b.updateSettings(project.id, limits), 'Limits saved')}>Save limits</Button>
      </Panel>
      <Panel title="Tokens, API usage & cost" bodyClassName="p-4 space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Stat label="Tokens" value={compact(r?.tokensTotal ?? 0)} />
          <Stat label="Estimated cost" value={usd(r?.costUsd ?? 0)} />
        </div>
        <Sparkline values={hist.map((h) => h.tokensTotal)} color="#f472b6" />
        <div className="space-y-1 text-[11.5px]">
          {[...byModel].map(([model, v]) => (
            <div key={model} className="flex justify-between text-ink-300"><span className="mono">{model}</span><span>{v.n} agents · {compact(v.tokens)} tok · {usd(v.cost)}</span></div>
          ))}
        </div>
        <div className="text-[10.5px] text-ink-500">Cost is estimated from list prices × reported usage.</div>
      </Panel>
      <Panel title="Top consumers (live)" bodyClassName="overflow-y-auto p-2">
        {!top.length && <div className="p-4 text-xs text-ink-400">No agent processes running right now.</div>}
        {top.map((a) => (
          <button key={a.id} onClick={() => useStore.getState().select(a.id, 'metrics')} className="flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left hover:bg-white/[0.04]">
            <span className="w-36 truncate text-[12px] text-ink-100">{a.name}</span>
            <div className="flex-1"><Meter value={a.cpu} max={200} color="#60a5fa" /></div>
            <span className="mono w-12 text-right text-[11px] text-ink-300">{a.cpu.toFixed(0)}%</span>
            <span className="mono w-16 text-right text-[11px] text-ink-300">{mb(a.memMb)}</span>
          </button>
        ))}
      </Panel>
    </div>
  );
}
