import { useState } from 'react';
import { Sparkles, ArrowRight, Loader2 } from 'lucide-react';
import { useStore } from '../../store/store';
import { act } from '../../store/controller';

export function ObjectiveBar() {
  const project = useStore((s) => s.project);
  const llm = useStore((s) => s.system?.llmConfigured);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  if (!project) return null;

  const submit = async () => {
    if (!value.trim() || busy) return;
    setBusy(true);
    const r = await act((b) => b.objective(project.id, value.trim()));
    setBusy(false);
    if (r) {
      setValue('');
      useStore.getState().toast({ tone: 'success', title: `Plan ready · ${r.planner}`, body: `${r.agents} agents · ${r.tasks} tasks — ${r.summary}` });
      setTimeout(() => useStore.setState((s) => ({ layoutRequest: s.layoutRequest + 1 })), 300);
    }
  };

  return (
    <div className="absolute left-4 top-4 z-10 w-[min(560px,calc(100%-500px))] min-w-[240px]">
      <div className="glass group flex h-10 items-center gap-2 rounded-2xl pl-3 pr-1 transition focus-within:shadow-[0_0_0_1px_rgba(96,165,250,0.45),0_10px_40px_-10px_rgba(59,130,246,0.5)]">
        <Sparkles size={14} className="shrink-0 text-violet-300" />
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          placeholder={project.objective ? `Objective: ${project.objective}` : 'Give the orchestrator an objective — e.g. “Build a complete football game”'}
          aria-label="Objective for the orchestrator"
          className="min-w-0 flex-1 bg-transparent text-[13px] text-ink-100 outline-none placeholder:text-ink-400"
        />
        <span className="hidden shrink-0 text-[10px] text-ink-400 lg:inline" title={llm ? 'Claude decomposes the objective into teams, agents and tasks' : 'No ANTHROPIC_API_KEY: plans come from offline templates'}>{llm ? 'Claude planner' : 'heuristic planner'}</span>
        <button onClick={submit} disabled={busy || !value.trim()} aria-label="Submit objective" className="grid h-8 w-8 place-items-center rounded-xl bg-gradient-to-b from-violet-500 to-blue-600 text-white transition hover:brightness-110 disabled:opacity-40">
          {busy ? <Loader2 size={14} className="animate-spin" /> : <ArrowRight size={14} />}
        </button>
      </div>
    </div>
  );
}
