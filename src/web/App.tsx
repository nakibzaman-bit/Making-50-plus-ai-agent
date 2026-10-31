import { lazy, Suspense, useEffect } from 'react';
import { FlaskConical, Loader2 } from 'lucide-react';
import { useStore } from './store/store';
import { boot } from './store/controller';
import { Intro } from './components/shell/Intro';
import { TopBar } from './components/shell/TopBar';
import { NavRail } from './components/shell/NavRail';
import { Toasts } from './components/shell/Toasts';
import { CommsDock } from './components/shell/CommsDock';
import { Inspector } from './components/inspector/Inspector';
import { CommandPalette } from './components/command/CommandPalette';
import { Dialogs } from './components/dialogs/Dialogs';
import { Empty, Button } from './components/ui';
import CommsView from './views/CommsView';

// Views are code-split; the 3D scene (three.js) only loads when 3D mode is opened.
const CanvasView = lazy(() => import('./components/canvas/CanvasView'));
const ThreeView = lazy(() => import('./components/three/ThreeView'));
const TreeView = lazy(() => import('./views/TreeView'));
const TasksView = lazy(() => import('./views/TasksView'));
const BranchesView = lazy(() => import('./views/BranchesView'));
const MergeView = lazy(() => import('./views/MergeView'));
const ResourcesView = lazy(() => import('./views/ResourcesView'));
const RolesView = lazy(() => import('./views/RolesView'));
const SettingsView = lazy(() => import('./views/SettingsView'));

function Main() {
  const view = useStore((s) => s.view);
  const dims = useStore((s) => s.dims);
  const project = useStore((s) => s.project);
  const loading = useStore((s) => s.loading);
  const mode = useStore((s) => s.mode);
  if (!project) {
    return loading ? (
      <div className="grid h-full place-items-center text-ink-400"><Loader2 className="animate-spin" /></div>
    ) : (
      <Empty title="No project open" body={mode === 'live' ? 'Create a project or open the NEXUS TEST LAB from the project menu.' : 'Loading demo…'} action={mode === 'live' ? <Button variant="primary" onClick={() => useStore.setState({ dialog: { kind: 'project' } })}>New project</Button> : undefined} />
    );
  }
  switch (view) {
    case 'canvas':
      return dims === '3d' ? <ThreeView /> : <CanvasView />;
    case 'tree':
      return <TreeView />;
    case 'tasks':
      return <TasksView />;
    case 'branches':
      return <BranchesView />;
    case 'merge':
      return <MergeView />;
    case 'comms':
      return <CommsView />;
    case 'resources':
      return <ResourcesView />;
    case 'roles':
      return <RolesView />;
    case 'settings':
      return <SettingsView />;
  }
}

export default function App() {
  const mode = useStore((s) => s.mode);
  useEffect(() => {
    void boot();
  }, []);
  return (
    <div className="flex h-full flex-col">
      <Intro />
      {mode === 'demo' && (
        <div className="z-30 flex h-6 shrink-0 items-center justify-center gap-2 bg-gradient-to-r from-amber-600/80 via-amber-500/80 to-amber-600/80 text-[10.5px] font-bold uppercase tracking-[0.2em] text-amber-950" role="status" data-testid="demo-banner">
          <FlaskConical size={12} /> Demo mode — simulated agents, no real processes, git or LLM calls
        </div>
      )}
      <TopBar />
      <div className="relative flex min-h-0 flex-1">
        <NavRail />
        <main className="relative min-w-0 flex-1 overflow-hidden">
          <div className="pointer-events-none absolute inset-0 overflow-hidden">
            <div className="grid-bg" />
            <div className="absolute -left-40 -top-40 h-[520px] w-[520px] rounded-full bg-blue-600/10 blur-3xl" />
            <div className="absolute -bottom-48 right-0 h-[560px] w-[560px] rounded-full bg-violet-600/10 blur-3xl" />
          </div>
          <div className="relative h-full">
            <Suspense fallback={<div className="grid h-full place-items-center text-ink-400"><Loader2 className="animate-spin" /></div>}>
              <Main />
            </Suspense>
          </div>
        </main>
        <Inspector />
      </div>
      <CommsDock />
      <CommandPalette />
      <Dialogs />
      <Toasts />
    </div>
  );
}
