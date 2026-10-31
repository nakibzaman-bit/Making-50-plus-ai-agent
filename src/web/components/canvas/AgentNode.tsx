import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import clsx from 'clsx';
import { GitBranch, Pause, Play, Square, RotateCcw, Bug, MessageSquare, FileCode2, Cpu, MemoryStick, Coins, Timer, FlaskConical, ChevronDown, ChevronRight } from 'lucide-react';
import { useStore } from '../../store/store';
import { agentTone, AGENT_STATUS_LABEL, TONE_HEX } from '../../lib/status';
import { compact as fmt, duration, mb } from '../../lib/format';
import { modelLabel } from '../../../shared/pricing';
import { Pill } from '../ui';
import { act } from '../../store/controller';

export type AgentNodeData = { agentId: string; dim?: boolean; hiddenCount?: number };

function Metric({ icon, label, value, className }: { icon: React.ReactNode; label: string; value: React.ReactNode; className?: string }) {
  return (
    <div className={clsx('flex min-w-0 items-center gap-1 text-[10px] text-ink-300', className)} title={label}>
      <span className="shrink-0 text-ink-400">{icon}</span>
      <span className="mono truncate text-ink-200">{value}</span>
    </div>
  );
}

export const AgentNode = memo(function AgentNode({ data, selected }: NodeProps) {
  const { agentId, dim, hiddenCount } = data as AgentNodeData;
  const agent = useStore((s) => s.agents[agentId]);
  const role = useStore((s) => s.roles.find((r) => r.id === agent?.roleId));
  const team = useStore((s) => (agent?.teamId ? s.teams[agent.teamId] : undefined));
  const task = useStore((s) => (agent?.currentTaskId ? s.tasks[agent.currentTaskId] : undefined));
  const lastTask = useStore((s) => {
    if (!agent || agent.currentTaskId) return undefined;
    let best: { title: string; t: number } | undefined;
    for (const t of Object.values(s.tasks)) if (t.assignedAgentId === agentId && (!best || t.updatedAt > best.t)) best = { title: t.title, t: t.updatedAt };
    return best?.title;
  });
  const pulse = useStore((s) => s.pulses[agentId]);
  const msgCount = useStore((s) => s.msgCounts[agentId] ?? 0);
  const compactMode = useStore((s) => s.compact);
  const isDemo = useStore((s) => s.mode === 'demo');
  if (!agent) return null;

  const tone = agentTone(agent.status);
  const color = TONE_HEX[tone];
  const accent = role?.color ?? '#60a5fa';
  const active = ['working', 'communicating'].includes(agent.status);
  const fresh = pulse && Date.now() - pulse.at < 1500;
  const busy = ['working', 'communicating', 'waiting'].includes(agent.status);
  const tokens = agent.tokensIn + agent.tokensOut;
  const remaining = agent.tokenBudget ? Math.max(0, agent.tokenBudget - tokens) : null;

  const stop = (e: React.MouseEvent) => e.stopPropagation();
  const action = (a: 'pause' | 'resume' | 'stop' | 'retry' | 'debug') => (e: React.MouseEvent) => {
    e.stopPropagation();
    void act((b) => b.agentAction(agentId, a));
  };

  if (compactMode) {
    return (
      <div className={clsx('agent-card relative rounded-2xl', dim && 'opacity-25', pulse?.kind === 'spawn' && fresh && 'animate-spawn')} style={{ width: 272 }}>
        <Handle type="target" position={Position.Top} />
        <div className="flex h-[120px] items-center gap-4 rounded-2xl px-5" style={{ background: 'linear-gradient(180deg, rgba(23,29,48,0.96), rgba(11,15,26,0.96))', boxShadow: `0 0 0 ${selected ? 4 : 2}px ${selected ? '#60a5fa' : color}${active || agent.status === 'failed' ? '' : '66'}${active ? `, 0 0 40px -4px ${color}` : ''}` }}>
          <span className="text-[44px] leading-none">{role?.icon ?? '🤖'}</span>
          <div className="min-w-0">
            <div className="line-clamp-2 text-[24px] font-bold leading-[1.1] text-white">{agent.name}</div>
            <div className="text-[18px] font-bold tracking-wider" style={{ color }}>{AGENT_STATUS_LABEL[agent.status]}</div>
          </div>
          {hiddenCount ? <span className="ml-auto text-[18px] font-bold text-ink-300">+{hiddenCount}</span> : null}
        </div>
        <Handle type="source" position={Position.Bottom} />
      </div>
    );
  }

  return (
    <div
      className={clsx(
        'agent-card group relative rounded-2xl transition-[opacity,transform,box-shadow] duration-300',
        pulse?.kind === 'spawn' && fresh && 'animate-spawn',
        pulse?.kind === 'fail' && fresh && 'animate-shake',
        dim && 'opacity-25',
      )}
      style={{ width: 272 }}
    >
      <Handle type="target" position={Position.Top} />
      <div
        className="relative overflow-hidden rounded-2xl"
        style={{
          background: 'linear-gradient(180deg, rgba(23,29,48,0.94), rgba(11,15,26,0.94))',
          boxShadow: `0 0 0 1px ${selected ? '#60a5fa' : `${color}${active ? '66' : '2e'}`}, 0 18px 40px -18px rgba(0,0,0,0.8)${active ? `, 0 0 28px -6px ${color}88` : ''}${agent.status === 'failed' ? `, 0 0 32px -4px ${color}aa` : ''}`,
        }}
      >
        <div className="absolute inset-x-0 top-0 h-[2px]" style={{ background: `linear-gradient(90deg, transparent, ${accent}, transparent)` }} />
        {active && <div className="shimmer pointer-events-none absolute inset-0 opacity-40" />}
        {fresh && pulse && <span key={pulse.at} className="pointer-events-none absolute inset-0 rounded-2xl" style={{ boxShadow: `inset 0 0 0 2px ${pulse.kind === 'msg' ? TONE_HEX.comm : pulse.kind === 'fail' ? TONE_HEX.fail : pulse.kind === 'commit' ? TONE_HEX.active : TONE_HEX.done}`, animation: 'pulse-soft 0.75s ease-out 2' }} />}

        <div className="relative p-3">
          <div className="flex items-start gap-2.5">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-lg" style={{ background: `${accent}1f`, boxShadow: `inset 0 0 0 1px ${accent}40` }}>
              {role?.icon ?? '🤖'}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <div className="truncate text-[13px] font-semibold text-white">{agent.name}</div>
                <span className="ml-auto shrink-0 rounded bg-white/[0.06] px-1 text-[9px] font-semibold text-ink-300" title="Priority">P{agent.priority}</span>
              </div>
              <div className="flex items-center gap-1.5 truncate text-[10px] text-ink-300">
                {team && <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: team.color }} />}
                <span className="truncate">{role?.name ?? agent.roleId}{team ? ` · ${team.name}` : ''}</span>
              </div>
            </div>
          </div>

          <div className="mt-2.5 flex items-center gap-1.5">
            <Pill tone={tone} pulse={active}>{AGENT_STATUS_LABEL[agent.status]}</Pill>
            <span className={clsx('rounded px-1.5 py-0.5 text-[9px] font-semibold tracking-wider', agent.runtime === 'claude' ? 'bg-violet-500/15 text-violet-300' : 'bg-cyan-500/10 text-cyan-300')}>
              {isDemo ? 'SIM' : agent.runtime === 'claude' ? 'LLM' : 'SCRIPTED'}
            </span>
            {hiddenCount ? <span className="ml-auto rounded bg-white/[0.06] px-1.5 text-[9px] text-ink-200">+{hiddenCount} hidden</span> : null}
          </div>

          {!compactMode && (
            <>
              <div className={clsx('mt-2 line-clamp-2 min-h-[30px] text-[11.5px] leading-snug', agent.status === 'failed' ? 'text-red-300' : agent.statusReason && !task ? 'text-amber-200/90' : 'text-ink-100')}>
                {agent.status === 'failed' ? `❌ ${agent.statusReason ?? 'Failed'}` : task?.title ?? agent.statusReason ?? (lastTask ? `Last: ${lastTask}` : <span className="text-ink-400">No task assigned</span>)}
              </div>

              <div className="mt-2 grid grid-cols-3 gap-x-2 gap-y-1 border-t hairline pt-2">
                <Metric icon={<span className="text-[9px]">◆</span>} label={`Model: ${agent.model}`} value={modelLabel(agent.model).replace('Claude ', '')} className="col-span-2" />
                <Metric icon={<Timer size={10} />} label="Runtime" value={duration(agent.runtimeMs)} />
                <Metric icon={<GitBranch size={10} />} label={`Branch: ${agent.branch ?? 'none'}`} value={agent.branch?.replace('agent/', '') ?? '—'} className="col-span-2" />
                <Metric icon={<FileCode2 size={10} />} label="Files changed" value={agent.filesChanged} />
                <Metric icon={<FlaskConical size={10} />} label="Tests passed / failed" value={<><span className="text-emerald-300">{agent.testsPassed}✓</span>{agent.testsFailed ? <span className="text-red-300"> {agent.testsFailed}✗</span> : null}</>} />
                <Metric icon={<Coins size={10} />} label={`Tokens used${remaining !== null ? ` · ${fmt(remaining)} remaining` : ''}`} value={fmt(tokens)} />
                <Metric icon={<MessageSquare size={10} />} label="Messages" value={msgCount} />
                <Metric icon={<Cpu size={10} />} label="CPU" value={`${agent.cpu.toFixed(0)}%`} />
                <Metric icon={<MemoryStick size={10} />} label="Memory" value={mb(agent.memMb)} />
                <Metric icon={<span className="text-[9px]">↻</span>} label="Retries" value={agent.retries} />
              </div>

              <div className="nodrag mt-2.5 flex items-center gap-1" onMouseDown={stop}>
                <button onClick={(e) => { e.stopPropagation(); useStore.getState().select(agentId, 'overview'); }} className="flex-1 rounded-lg bg-white/[0.06] py-1 text-[10px] font-semibold tracking-wider text-ink-100 transition hover:bg-white/[0.12]">OPEN</button>
                {agent.status === 'failed' ? (
                  <>
                    <button onClick={action('retry')} className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-amber-500/10 py-1 text-[10px] font-semibold tracking-wider text-amber-300 hover:bg-amber-500/20"><RotateCcw size={10} />RETRY</button>
                    <button onClick={action('debug')} className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-red-500/10 py-1 text-[10px] font-semibold tracking-wider text-red-300 hover:bg-red-500/20"><Bug size={10} />DEBUG</button>
                  </>
                ) : agent.status === 'paused' || agent.status === 'stopped' ? (
                  <button onClick={action('resume')} className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-emerald-500/10 py-1 text-[10px] font-semibold tracking-wider text-emerald-300 hover:bg-emerald-500/20"><Play size={10} />RESUME</button>
                ) : (
                  <button onClick={action('pause')} disabled={!busy} className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-white/[0.04] py-1 text-[10px] font-semibold tracking-wider text-ink-200 hover:bg-white/[0.1] disabled:opacity-30"><Pause size={10} />PAUSE</button>
                )}
                {agent.status !== 'failed' && (
                  <button onClick={action('stop')} disabled={agent.status === 'stopped'} className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-white/[0.04] py-1 text-[10px] font-semibold tracking-wider text-ink-200 hover:bg-red-500/15 hover:text-red-300 disabled:opacity-30"><Square size={9} />STOP</button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
});

export const TeamZone = memo(function TeamZone({ data }: NodeProps) {
  const { teamId, width, height, count } = data as { teamId: string; width: number; height: number; count: number };
  const team = useStore((s) => s.teams[teamId]);
  if (!team) return null;
  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    void act((b) => b.updateTeam(teamId, { collapsed: !team.collapsed }));
  };
  return (
    <div className="pointer-events-none rounded-[28px]" style={{ width, height, background: `radial-gradient(ellipse at top, ${team.color}12, transparent 70%)`, boxShadow: `inset 0 0 0 1px ${team.color}26` }}>
      <button onClick={toggle} className="nodrag pointer-events-auto absolute -top-3 left-6 flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em]" style={{ color: team.color, background: '#0b0f1a', boxShadow: `inset 0 0 0 1px ${team.color}40` }}>
        {team.collapsed ? <ChevronRight size={11} /> : <ChevronDown size={11} />}
        {team.name}
        <span className="text-ink-400">{count}</span>
      </button>
    </div>
  );
});
