import { create } from 'zustand';
import type { ServerEvent } from '../../shared/events';
import type {
  Agent,
  Approval,
  Link,
  LogLine,
  MergeRequest,
  Message,
  Project,
  ProjectMetrics,
  ProjectSnapshot,
  ResourceSnapshot,
  RoleDefinition,
  SystemInfo,
  Task,
  Team,
} from '../../shared/types';

export type View = 'canvas' | 'tree' | 'tasks' | 'branches' | 'merge' | 'comms' | 'resources' | 'roles' | 'settings';
export type InspectorTab = 'overview' | 'terminal' | 'files' | 'git' | 'tasks' | 'messages' | 'metrics' | 'prompt';
export type Mode = 'live' | 'demo';

export interface Toast {
  id: number;
  tone: 'info' | 'success' | 'warn' | 'error';
  title: string;
  body?: string;
  action?: { label: string; run: () => void };
}

export interface FeedLine {
  id: number;
  line: string;
  level: 'info' | 'success' | 'warn' | 'error';
  at: number;
}

export interface Pulse {
  kind: 'spawn' | 'done' | 'fail' | 'msg' | 'commit' | 'merge';
  at: number;
}

const LOG_CAP = 3000;
const MSG_CAP = 1500;
const HISTORY = 90;

type Dict<T> = Record<string, T>;

interface State {
  mode: Mode;
  connection: 'connecting' | 'open' | 'closed';
  system: SystemInfo | null;
  roles: RoleDefinition[];
  projects: Project[];
  projectId: string | null;
  loading: boolean;
  project: Project | null;
  teams: Dict<Team>;
  agents: Dict<Agent>;
  tasks: Dict<Task>;
  merges: Dict<MergeRequest>;
  approvals: Dict<Approval>;
  links: Dict<Link>;
  messages: Message[];
  msgCounts: Dict<number>;
  logs: Dict<LogLine[]>;
  feed: FeedLine[];
  metrics: ProjectMetrics | null;
  resources: ResourceSnapshot | null;
  resourceHistory: ResourceSnapshot[];
  agentHistory: Dict<{ t: number; cpu: number; mem: number; tokens: number }[]>;
  comms: { from: string; to: string; at: number }[];
  pulses: Dict<Pulse>;
  gitVersion: number;
  // UI
  view: View;
  dims: '2d' | '3d';
  selectedAgentId: string | null;
  selectedTaskId: string | null;
  inspectorTab: InspectorTab;
  inspectorFile: string | null;
  paletteOpen: boolean;
  dialog: null | { kind: 'spawn' | 'task' | 'project' | 'team'; preset?: Record<string, unknown> };
  canvasQuery: string;
  focusRequest: { agentId: string; at: number } | null;
  layoutRequest: number;
  compact: boolean;
  toasts: Toast[];
  introDone: boolean;
}

interface Actions {
  set: (p: Partial<State>) => void;
  setMode: (m: Mode) => void;
  loadSnapshot: (s: ProjectSnapshot) => void;
  clearProject: () => void;
  applyEvent: (e: ServerEvent) => void;
  mergeLogs: (agentId: string, lines: LogLine[]) => void;
  select: (agentId: string | null, tab?: InspectorTab) => void;
  openTask: (taskId: string | null) => void;
  focusAgent: (agentId: string) => void;
  toast: (t: Omit<Toast, 'id'>) => void;
  dismissToast: (id: number) => void;
}

let seq = 1;
function countMessages(ms: Message[]): Dict<number> {
  const c: Dict<number> = {};
  for (const m of ms) for (const k of [m.fromAgentId, m.toAgentId]) if (k) c[k] = (c[k] ?? 0) + 1;
  return c;
}
const byId = <T extends { id: string }>(xs: T[]): Dict<T> => Object.fromEntries(xs.map((x) => [x.id, x]));

export const useStore = create<State & Actions>((set, get) => ({
  mode: (localStorage.getItem('nexus.mode') as Mode) || 'live',
  connection: 'connecting',
  system: null,
  roles: [],
  projects: [],
  projectId: null,
  loading: false,
  project: null,
  teams: {},
  agents: {},
  tasks: {},
  merges: {},
  approvals: {},
  links: {},
  messages: [],
  msgCounts: {},
  logs: {},
  feed: [],
  metrics: null,
  resources: null,
  resourceHistory: [],
  agentHistory: {},
  comms: [],
  pulses: {},
  gitVersion: 0,
  view: 'canvas',
  dims: '2d',
  selectedAgentId: null,
  selectedTaskId: null,
  inspectorTab: 'overview',
  inspectorFile: null,
  paletteOpen: false,
  dialog: null,
  canvasQuery: '',
  focusRequest: null,
  layoutRequest: 0,
  compact: false,
  toasts: [],
  introDone: sessionStorage.getItem('nexus.intro') === '1',

  set: (p) => set(p),

  setMode: (mode) => {
    localStorage.setItem('nexus.mode', mode);
    get().clearProject();
    set({ mode, projects: [], projectId: null });
  },

  clearProject: () =>
    set({
      project: null,
      teams: {},
      agents: {},
      tasks: {},
      merges: {},
      approvals: {},
      links: {},
      messages: [],
      msgCounts: {},
      logs: {},
      feed: [],
      metrics: null,
      resources: null,
      resourceHistory: [],
      agentHistory: {},
      comms: [],
      pulses: {},
      selectedAgentId: null,
      selectedTaskId: null,
    }),

  loadSnapshot: (s) =>
    set({
      project: s.project,
      projectId: s.project.id,
      teams: byId(s.teams),
      agents: byId(s.agents),
      tasks: byId(s.tasks),
      merges: byId(s.merges),
      approvals: byId(s.approvals),
      links: byId(s.links),
      messages: s.messages,
      msgCounts: countMessages(s.messages),
      metrics: s.metrics,
      resources: s.resources,
      resourceHistory: s.resources ? [s.resources] : [],
      loading: false,
    }),

  applyEvent: (e) => {
    const st = get();
    if ('projectId' in e && e.type !== 'project.updated' && e.type !== 'project.deleted' && e.projectId !== st.projectId) return;
    switch (e.type) {
      case 'project.updated': {
        const projects = st.projects.some((p) => p.id === e.project.id) ? st.projects.map((p) => (p.id === e.project.id ? e.project : p)) : [...st.projects, e.project];
        const prev = st.project;
        set({ projects, project: st.projectId === e.project.id ? e.project : st.project });
        if (prev && prev.id === e.project.id && prev.status !== e.project.status) {
          if (e.project.status === 'completed') st.toast({ tone: 'success', title: 'Objective complete', body: e.project.name });
          if (e.project.status === 'failed') st.toast({ tone: 'error', title: 'Objective finished with failures', body: e.project.name });
        }
        break;
      }
      case 'project.deleted':
        set({ projects: st.projects.filter((p) => p.id !== e.projectId) });
        if (st.projectId === e.projectId) st.clearProject();
        break;
      case 'team.upserted':
        set({ teams: { ...st.teams, [e.team.id]: e.team } });
        break;
      case 'team.removed': {
        const { [e.teamId]: _gone, ...teams } = st.teams;
        set({ teams });
        break;
      }
      case 'agent.upserted': {
        const prev = st.agents[e.agent.id];
        const a = e.agent;
        let pulses = st.pulses;
        if (!prev) pulses = { ...pulses, [a.id]: { kind: 'spawn', at: Date.now() } };
        else if (prev.status !== a.status) {
          if (a.status === 'completed') pulses = { ...pulses, [a.id]: { kind: 'done', at: Date.now() } };
          if (a.status === 'failed') {
            pulses = { ...pulses, [a.id]: { kind: 'fail', at: Date.now() } };
            if (st.mode === 'live') st.toast({ tone: 'error', title: `${a.name} failed`, body: a.statusReason ?? undefined, action: { label: 'Inspect', run: () => get().select(a.id, 'overview') } });
          }
        }
        const hist = st.agentHistory[a.id] ?? [];
        const last = hist[hist.length - 1];
        const now = Date.now();
        const agentHistory = !last || now - last.t > 900 ? { ...st.agentHistory, [a.id]: [...hist.slice(-HISTORY), { t: now, cpu: a.cpu, mem: a.memMb, tokens: a.tokensIn + a.tokensOut }] } : st.agentHistory;
        set({ agents: { ...st.agents, [a.id]: a }, pulses, agentHistory });
        break;
      }
      case 'agent.removed': {
        const { [e.agentId]: _gone, ...agents } = st.agents;
        set({ agents, selectedAgentId: st.selectedAgentId === e.agentId ? null : st.selectedAgentId });
        break;
      }
      case 'task.upserted':
        set({ tasks: { ...st.tasks, [e.task.id]: e.task } });
        break;
      case 'task.removed': {
        const { [e.taskId]: _gone, ...tasks } = st.tasks;
        set({ tasks });
        break;
      }
      case 'message.created': {
        const m = e.message;
        const messages = st.messages.length >= MSG_CAP ? [...st.messages.slice(-MSG_CAP + 1), m] : [...st.messages, m];
        const comms = m.fromAgentId && m.toAgentId ? [...st.comms.filter((c) => Date.now() - c.at < 6000), { from: m.fromAgentId, to: m.toAgentId, at: Date.now() }] : st.comms;
        const pulses = m.fromAgentId ? { ...st.pulses, [m.fromAgentId]: { kind: 'msg' as const, at: Date.now() } } : st.pulses;
        const msgCounts = { ...st.msgCounts };
        for (const k of [m.fromAgentId, m.toAgentId]) if (k) msgCounts[k] = (msgCounts[k] ?? 0) + 1;
        set({ messages, comms, pulses, msgCounts });
        break;
      }
      case 'log.batch': {
        const logs = { ...st.logs };
        for (const l of e.lines) {
          const k = l.agentId ?? '_system';
          const arr = logs[k] ?? [];
          logs[k] = arr.length >= LOG_CAP ? [...arr.slice(-LOG_CAP + 1), l] : [...arr, l];
        }
        set({ logs });
        break;
      }
      case 'git.commit':
        set({ gitVersion: st.gitVersion + 1, pulses: e.agentId ? { ...st.pulses, [e.agentId]: { kind: 'commit', at: Date.now() } } : st.pulses });
        break;
      case 'git.branch':
        set({ gitVersion: st.gitVersion + 1, pulses: e.agentId && e.action === 'merged' ? { ...st.pulses, [e.agentId]: { kind: 'merge', at: Date.now() } } : st.pulses });
        break;
      case 'merge.upserted': {
        const prev = st.merges[e.merge.id];
        if (e.merge.status === 'awaiting_approval' && prev?.status !== 'awaiting_approval')
          st.toast({ tone: 'warn', title: 'Merge awaiting your approval', body: e.merge.branch, action: { label: 'Review', run: () => get().set({ view: 'merge' }) } });
        set({ merges: { ...st.merges, [e.merge.id]: e.merge } });
        break;
      }
      case 'approval.upserted': {
        const prev = st.approvals[e.approval.id];
        if (!prev && e.approval.status === 'pending' && e.approval.kind === 'command')
          st.toast({ tone: 'warn', title: 'Command needs approval', body: e.approval.reason, action: { label: 'Review', run: () => get().set({ view: 'merge' }) } });
        set({ approvals: { ...st.approvals, [e.approval.id]: e.approval } });
        break;
      }
      case 'link.upserted':
        set({ links: { ...st.links, [e.link.id]: e.link } });
        break;
      case 'link.removed': {
        const { [e.linkId]: _gone, ...links } = st.links;
        set({ links });
        break;
      }
      case 'metrics.tick':
        set({ metrics: e.metrics, resources: e.resources, resourceHistory: [...st.resourceHistory.slice(-HISTORY), e.resources] });
        break;
      case 'orchestrator.log':
        set({ feed: [...st.feed.slice(-250), { id: seq++, line: e.line, level: e.level, at: Date.now() }] });
        break;
    }
  },

  mergeLogs: (agentId, lines) => {
    const existing = get().logs[agentId] ?? [];
    const seen = new Set(existing.map((l) => l.id));
    const merged = [...lines.filter((l) => !seen.has(l.id)), ...existing].sort((a, b) => a.id - b.id).slice(-LOG_CAP);
    set({ logs: { ...get().logs, [agentId]: merged } });
  },

  select: (agentId, tab) => set({ selectedAgentId: agentId, inspectorTab: tab ?? get().inspectorTab, inspectorFile: null }),
  openTask: (taskId) => set({ selectedTaskId: taskId }),
  focusAgent: (agentId) => set({ focusRequest: { agentId, at: Date.now() }, selectedAgentId: agentId, view: get().view === 'canvas' ? 'canvas' : get().view }),

  toast: (t) => {
    const id = seq++;
    set({ toasts: [...get().toasts.slice(-4), { ...t, id }] });
    setTimeout(() => get().dismissToast(id), t.tone === 'error' ? 7000 : 4500);
  },
  dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}));

export const useAgentsList = () => useStore((s) => s.agents);
