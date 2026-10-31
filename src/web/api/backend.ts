import type {
  Agent,
  AgentGitState,
  BranchInfo,
  CommitInfo,
  LogLine,
  Message,
  Project,
  ProjectSettings,
  ProjectSnapshot,
  RoleDefinition,
  SearchResult,
  SystemInfo,
  Task,
  Team,
  TestSummary,
} from '../../shared/types';
import { del, get, patch, post } from './client';

export interface SpawnAgentInput {
  roleId: string;
  name?: string;
  teamId?: string | null;
  parentId?: string | null;
  runtime?: 'claude' | 'scripted';
  model?: string;
  priority?: number;
  count?: number;
}

export interface CreateTaskInput {
  title: string;
  description?: string;
  priority?: number;
  roleHint?: string | null;
  assignedAgentId?: string | null;
  dependsOn?: string[];
  requiresApproval?: boolean;
}

/** Everything the UI can ask of a backend. LIVE talks to the server; DEMO simulates in-browser. */
export interface Backend {
  readonly kind: 'live' | 'demo';
  system(): Promise<SystemInfo>;
  projects(): Promise<Project[]>;
  createProject(input: { name: string; description?: string; settings?: Partial<ProjectSettings> }): Promise<Project>;
  loadTestLab(): Promise<Project>;
  deleteProject(id: string): Promise<void>;
  snapshot(projectId: string): Promise<ProjectSnapshot>;
  updateSettings(projectId: string, s: Partial<ProjectSettings>): Promise<Project>;
  objective(projectId: string, objective: string): Promise<{ summary: string; planner: string; agents: number; tasks: number }>;
  run(projectId: string): Promise<unknown>;
  halt(projectId: string): Promise<unknown>;
  roles(): Promise<RoleDefinition[]>;
  saveRole(role: Partial<RoleDefinition> & { name: string; systemPrompt: string }): Promise<RoleDefinition>;
  deleteRole(id: string): Promise<void>;
  spawnAgent(projectId: string, input: SpawnAgentInput): Promise<Agent | Agent[]>;
  updateAgent(id: string, patch: Partial<Agent>): Promise<Agent>;
  savePositions(projectId: string, positions: { id: string; x: number; y: number }[]): Promise<void>;
  deleteAgent(id: string, deleteBranch?: boolean): Promise<void>;
  agentAction(id: string, action: 'pause' | 'resume' | 'stop' | 'retry' | 'debug' | 'merge'): Promise<unknown>;
  runTests(id: string): Promise<TestSummary>;
  agentLogs(id: string): Promise<LogLine[]>;
  agentGit(id: string): Promise<AgentGitState>;
  agentFiles(id: string): Promise<string[]>;
  agentFile(id: string, path: string, version: 'current' | 'base'): Promise<{ content: string | null }>;
  agentDiff(id: string, path: string): Promise<{ diff: string }>;
  revertFile(id: string, path: string): Promise<unknown>;
  createTask(projectId: string, input: CreateTaskInput): Promise<Task>;
  taskAction(id: string, action: 'cancel' | 'retry'): Promise<Task>;
  reassignTask(id: string, agentId: string | null): Promise<Task>;
  requestChanges(id: string, feedback: string): Promise<Task>;
  addDependency(id: string, dependsOn: string): Promise<Task>;
  removeDependency(id: string, dependsOn: string): Promise<Task>;
  sendMessage(projectId: string, input: { body: string; toAgentId?: string | null; teamId?: string | null }): Promise<Message>;
  createTeam(projectId: string, name: string): Promise<Team>;
  updateTeam(id: string, patch: Partial<Team>): Promise<Team>;
  deleteTeam(id: string): Promise<void>;
  link(projectId: string, sourceAgentId: string, targetAgentId: string): Promise<unknown>;
  unlink(id: string): Promise<void>;
  branches(projectId: string): Promise<BranchInfo[]>;
  commits(projectId: string, branch: string): Promise<CommitInfo[]>;
  mergeAction(id: string, action: 'approve' | 'reject' | 'retry'): Promise<unknown>;
  approval(id: string, approve: boolean): Promise<unknown>;
  search(projectId: string | null, q: string): Promise<SearchResult[]>;
}

const enc = encodeURIComponent;

export const liveBackend: Backend = {
  kind: 'live',
  system: () => get('/api/system'),
  projects: () => get('/api/projects'),
  createProject: (input) => post('/api/projects', input),
  loadTestLab: () => post('/api/projects/test-lab'),
  deleteProject: async (id) => void (await del(`/api/projects/${id}`)),
  snapshot: (id) => get(`/api/projects/${id}/snapshot`),
  updateSettings: (id, s) => patch(`/api/projects/${id}/settings`, s),
  objective: (id, objective) => post(`/api/projects/${id}/objective`, { objective }),
  run: (id) => post(`/api/projects/${id}/run`),
  halt: (id) => post(`/api/projects/${id}/halt`),
  roles: () => get('/api/roles'),
  saveRole: (role) => post('/api/roles', role),
  deleteRole: async (id) => void (await del(`/api/roles/${id}`)),
  spawnAgent: (pid, input) => post(`/api/projects/${pid}/agents`, input),
  updateAgent: (id, p) => patch(`/api/agents/${id}`, p),
  savePositions: async (pid, positions) => void (await post(`/api/projects/${pid}/positions`, { positions })),
  deleteAgent: async (id, deleteBranch) => void (await del(`/api/agents/${id}${deleteBranch ? '?deleteBranch=true' : ''}`)),
  agentAction: (id, action) => post(`/api/agents/${id}/${action}`),
  runTests: (id) => post(`/api/agents/${id}/test`),
  agentLogs: (id) => get(`/api/agents/${id}/logs?limit=3000`),
  agentGit: (id) => get(`/api/agents/${id}/git`),
  agentFiles: (id) => get(`/api/agents/${id}/files`),
  agentFile: (id, path, version) => get(`/api/agents/${id}/file?path=${enc(path)}&version=${version}`),
  agentDiff: (id, path) => get(`/api/agents/${id}/diff?path=${enc(path)}`),
  revertFile: (id, path) => post(`/api/agents/${id}/revert`, { path }),
  createTask: (pid, input) => post(`/api/projects/${pid}/tasks`, input),
  taskAction: (id, action) => post(`/api/tasks/${id}/${action}`),
  reassignTask: (id, agentId) => post(`/api/tasks/${id}/reassign`, { agentId }),
  requestChanges: (id, feedback) => post(`/api/tasks/${id}/request-changes`, { feedback }),
  addDependency: (id, dependsOn) => post(`/api/tasks/${id}/deps`, { dependsOn }),
  removeDependency: (id, dep) => del(`/api/tasks/${id}/deps/${dep}`),
  sendMessage: (pid, input) => post(`/api/projects/${pid}/messages`, input),
  createTeam: (pid, name) => post(`/api/projects/${pid}/teams`, { name }),
  updateTeam: (id, p) => patch(`/api/teams/${id}`, p),
  deleteTeam: async (id) => void (await del(`/api/teams/${id}`)),
  link: (pid, s, t) => post(`/api/projects/${pid}/links`, { sourceAgentId: s, targetAgentId: t }),
  unlink: async (id) => void (await del(`/api/links/${id}`)),
  branches: (pid) => get(`/api/projects/${pid}/branches`),
  commits: (pid, branch) => get(`/api/projects/${pid}/commits?branch=${enc(branch)}`),
  mergeAction: (id, action) => post(`/api/merges/${id}/${action}`),
  approval: (id, approve) => post(`/api/approvals/${id}/${approve ? 'approve' : 'deny'}`),
  search: (pid, q) => get(pid ? `/api/projects/${pid}/search?q=${enc(q)}` : `/api/search?q=${enc(q)}`),
};
