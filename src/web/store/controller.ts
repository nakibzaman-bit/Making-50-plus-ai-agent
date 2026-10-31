import { liveBackend, type Backend } from '../api/backend';
import { LiveSocket } from '../api/ws';
import { demoBackend } from '../demo/demoBackend';
import { useStore } from './store';

let socket: LiveSocket | null = null;
const LAST = 'nexus.lastProject';

export function backend(): Backend {
  return useStore.getState().mode === 'demo' ? demoBackend : liveBackend;
}

/** Run a backend action with uniform error toasts. */
export async function act<T>(fn: (b: Backend) => Promise<T>, success?: string): Promise<T | undefined> {
  try {
    const r = await fn(backend());
    if (success) useStore.getState().toast({ tone: 'success', title: success });
    return r;
  } catch (e) {
    useStore.getState().toast({ tone: 'error', title: 'Action failed', body: (e as Error).message });
    return undefined;
  }
}

export async function boot() {
  const st = useStore.getState();
  socket?.close();
  socket = null;
  demoBackend.detach();
  const b = backend();
  if (b.kind === 'demo') {
    demoBackend.attach((e) => useStore.getState().applyEvent(e));
    useStore.setState({ connection: 'open' });
  } else {
    socket = new LiveSocket(
      (e) => useStore.getState().applyEvent(e),
      (connection) => useStore.setState({ connection }),
      () => {
        const pid = useStore.getState().projectId;
        if (pid) void openProject(pid);
      },
    );
    socket.connect();
  }
  try {
    const [system, roles, projects] = await Promise.all([b.system(), b.roles(), b.projects()]);
    useStore.setState({ system, roles, projects });
    const preferred = localStorage.getItem(LAST);
    const target = projects.find((p) => p.id === preferred) ?? projects.find((p) => p.name === 'NEXUS TEST LAB') ?? projects[0];
    if (target) await openProject(target.id);
  } catch (e) {
    st.toast({ tone: 'error', title: 'Cannot reach the NEXUS server', body: `${(e as Error).message}. Start it with "npm run dev".` });
    useStore.setState({ connection: 'closed' });
  }
}

export async function openProject(projectId: string) {
  const st = useStore.getState();
  if (st.projectId !== projectId) st.clearProject();
  useStore.setState({ projectId, loading: true });
  socket?.subscribe(projectId);
  try {
    const snap = await backend().snapshot(projectId);
    useStore.getState().loadSnapshot(snap);
    if (backend().kind === 'live') localStorage.setItem(LAST, projectId);
  } catch (e) {
    useStore.setState({ loading: false });
    st.toast({ tone: 'error', title: 'Failed to load project', body: (e as Error).message });
  }
}

export async function refreshRoles() {
  const roles = await backend().roles();
  useStore.setState({ roles });
}
