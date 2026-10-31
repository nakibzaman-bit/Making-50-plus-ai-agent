import { useEffect, useState } from 'react';
import type { ProjectSettings } from '../../shared/types';
import { useStore } from '../store/store';
import { act } from '../store/controller';
import { Badge, Button, Field, Input, Panel, Select, Toggle } from '../components/ui';

export default function SettingsView() {
  const project = useStore((s) => s.project);
  const system = useStore((s) => s.system);
  const [s, setS] = useState<ProjectSettings | null>(null);
  useEffect(() => setS(project?.settings ?? null), [project]);
  if (!project || !s) return null;
  const set = <K extends keyof ProjectSettings>(k: K, v: ProjectSettings[K]) => setS({ ...s, [k]: v });
  return (
    <div className="grid h-full grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] gap-3 overflow-y-auto p-4">
      <Panel title={`Project settings · ${project.name}`} bodyClassName="space-y-4 p-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Test command" hint="Runs in each agent worktree after its task and in the merge pipeline."><Input className="mono" value={s.testCommand} onChange={(e) => set('testCommand', e.target.value)} /></Field>
          <Field label="Integration command" hint="Runs on main + branch before merging (defaults to tests)."><Input className="mono" value={s.integrationCommand} onChange={(e) => set('integrationCommand', e.target.value)} /></Field>
          <Field label="Lint command"><Input className="mono" value={s.lintCommand} onChange={(e) => set('lintCommand', e.target.value)} /></Field>
          <Field label="Build command"><Input className="mono" value={s.buildCommand} onChange={(e) => set('buildCommand', e.target.value)} /></Field>
          <Field label="Default runtime">
            <Select value={s.defaultRuntime} onChange={(e) => set('defaultRuntime', e.target.value as ProjectSettings['defaultRuntime'])}>
              <option value="claude">Claude (LLM agents)</option>
              <option value="scripted">Scripted (deterministic, no LLM)</option>
            </Select>
          </Field>
          <Field label="Default model">
            <Select value={s.defaultModel} onChange={(e) => set('defaultModel', e.target.value)}>
              {['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-fable-5-1'].map((m) => <option key={m}>{m}</option>)}
            </Select>
          </Field>
          <Field label="Max attempts per task"><Input type="number" min={1} max={10} value={s.maxTaskAttempts} onChange={(e) => set('maxTaskAttempts', Number(e.target.value))} /></Field>
        </div>
        <div className="flex flex-wrap gap-5">
          <Toggle checked={s.autoMerge} onChange={(v) => set('autoMerge', v)} label="Auto-merge verified branches" />
          <Toggle checked={s.requireApproval} onChange={(v) => set('requireApproval', v)} label="Require human approval for every merge" />
          <Toggle checked={s.autoDebug} onChange={(v) => set('autoDebug', v)} label="Auto-spawn debugger on failure" />
        </div>
        <div className="text-[11px] text-ink-400">Commands run without a shell: one command each (no &&, pipes or redirects).</div>
        <Button variant="primary" onClick={() => void act((b) => b.updateSettings(project.id, s), 'Settings saved')}>Save settings</Button>
      </Panel>
      <Panel title="System" bodyClassName="space-y-3 p-4 text-[12.5px]">
        {system && (
          <>
            <div className="grid grid-cols-2 gap-2">
              {[['Version', system.version], ['Platform', system.platform], ['Node', system.node], ['Executor', system.executor], ['Default model', system.defaultModel]].map(([k, v]) => (
                <div key={k}><div className="text-[10px] uppercase tracking-wider text-ink-400">{k}</div><div className="mono text-ink-100">{v}</div></div>
              ))}
            </div>
            <div>
              <div className="mb-1 text-[10px] uppercase tracking-wider text-ink-400">Agent runtimes</div>
              {system.runtimes.map((r) => (
                <div key={r.kind} className="flex items-center gap-2 py-1">
                  <Badge color={r.available ? '#22c55e' : '#ef4444'}>{r.available ? 'available' : 'unavailable'}</Badge>
                  <span className="mono text-ink-100">{r.kind}</span>
                  {r.reason && <span className="text-[11px] text-ink-400">{r.reason}</span>}
                </div>
              ))}
            </div>
            {!system.llmConfigured && (
              <div className="rounded-xl border border-amber-400/30 bg-amber-500/[0.06] p-3 text-[12px] text-amber-100">
                To run LLM agents, set <span className="mono">ANTHROPIC_API_KEY</span> in the server's <span className="mono">.env</span> and restart. The key stays on the server — it is never sent to the browser or to agent processes.
              </div>
            )}
          </>
        )}
      </Panel>
    </div>
  );
}
