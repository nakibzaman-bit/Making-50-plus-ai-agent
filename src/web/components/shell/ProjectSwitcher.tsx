import { useEffect, useRef, useState } from 'react';
import { ChevronDown, FolderPlus, FlaskConical, Check, Trash2 } from 'lucide-react';
import clsx from 'clsx';
import { useStore } from '../../store/store';
import { act, openProject } from '../../store/controller';
import { StatusDot } from '../ui';
import type { Tone } from '../../lib/status';

const projectTone = (s: string): Tone => (s === 'running' ? 'active' : s === 'completed' ? 'done' : s === 'failed' ? 'fail' : s === 'paused' || s === 'planning' ? 'wait' : 'idle');

export function ProjectSwitcher() {
  const projects = useStore((s) => s.projects);
  const project = useStore((s) => s.project);
  const mode = useStore((s) => s.mode);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen(!open)} className="flex h-8 max-w-[240px] items-center gap-2 rounded-lg border border-white/[0.08] bg-white/[0.03] px-2.5 text-xs font-medium text-ink-100 transition hover:bg-white/[0.07]" data-testid="project-switcher">
        {project && <StatusDot tone={projectTone(project.status)} pulse={project.status === 'running'} size={7} />}
        <span className="truncate">{project?.name ?? 'Select project'}</span>
        <ChevronDown size={13} className="shrink-0 text-ink-400" />
      </button>
      {open && (
        <div className="glass-strong absolute left-0 top-10 z-50 w-80 rounded-2xl p-1.5" style={{ animation: 'fade-up .15s ease-out' }}>
          <div className="px-2.5 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-400">Projects</div>
          <div className="max-h-80 overflow-y-auto">
            {projects.map((p) => (
              <div key={p.id} className={clsx('group flex items-center gap-2 rounded-xl px-2.5 py-2 text-sm transition hover:bg-white/[0.06]', p.id === project?.id && 'bg-white/[0.05]')}>
                <button className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => { setOpen(false); void openProject(p.id); }}>
                  <StatusDot tone={projectTone(p.status)} size={7} />
                  <div className="min-w-0">
                    <div className="truncate text-[13px] text-ink-100">{p.name}</div>
                    <div className="truncate text-[11px] text-ink-400">{p.status} · {p.description || p.objective || 'No objective yet'}</div>
                  </div>
                  {p.id === project?.id && <Check size={13} className="ml-auto shrink-0 text-blue-400" />}
                </button>
                {mode === 'live' && (
                  <button aria-label={`Delete ${p.name}`} className="hidden text-ink-400 hover:text-red-400 group-hover:block" onClick={() => confirm(`Delete "${p.name}" including its repository and all worktrees?`) && void act((b) => b.deleteProject(p.id), 'Project deleted')}>
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
            ))}
          </div>
          {mode === 'live' && (
            <div className="mt-1 border-t hairline pt-1">
              <button className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-[13px] text-ink-200 hover:bg-white/[0.06]" onClick={() => { setOpen(false); useStore.setState({ dialog: { kind: 'project' } }); }}><FolderPlus size={14} /> New project</button>
              <button className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-[13px] text-ink-200 hover:bg-white/[0.06]" onClick={async () => { setOpen(false); const p = await act((b) => b.loadTestLab()); if (p) { useStore.setState((s) => ({ projects: s.projects.some((x) => x.id === p.id) ? s.projects : [...s.projects, p] })); void openProject(p.id); } }}><FlaskConical size={14} /> Open NEXUS TEST LAB</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
