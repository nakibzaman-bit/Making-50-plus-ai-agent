// Shared domain types used by both the server and the web client.

export const AGENT_STATUSES = [
  'idle',
  'queued',
  'working',
  'waiting',
  'paused',
  'communicating',
  'completed',
  'failed',
  'stopped',
] as const;
export type AgentStatus = (typeof AGENT_STATUSES)[number];

export const TASK_STATUSES = [
  'backlog',
  'queued',
  'assigned',
  'working',
  'waiting',
  'blocked',
  'review',
  'testing',
  'completed',
  'failed',
  'cancelled',
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TERMINAL_TASK_STATUSES: readonly TaskStatus[] = ['completed', 'failed', 'cancelled'];

export type RuntimeKind = 'claude' | 'scripted';

export type Permission =
  | 'fs.read'
  | 'fs.write'
  | 'exec'
  | 'exec.network'
  | 'git.commit'
  | 'agents.spawn'
  | 'tasks.create'
  | 'merge.request'
  | 'messages.broadcast';

export interface ResourceLimits {
  /** Max wall-clock seconds for a single command. */
  commandTimeoutSec: number;
  /** RSS ceiling in MB for an agent's process tree; exceeded => killed. */
  maxMemoryMb: number;
  /** Max model/tool iterations for one task run. */
  maxIterations: number;
  /** Token budget per agent (input + output). 0 = unlimited. */
  tokenBudget: number;
}

export interface RoleDefinition {
  id: string;
  name: string;
  icon: string;
  description: string;
  systemPrompt: string;
  capabilities: string[];
  tools: string[];
  permissions: Permission[];
  preferredModel: string;
  taskTypes: string[];
  priority: number;
  limits: ResourceLimits;
  builtin: boolean;
  /** UI accent color (hex). */
  color: string;
}

export interface ProjectSettings {
  maxAgents: number;
  maxConcurrentTasks: number;
  /** Max aggregate CPU percentage (sum across agent processes, 100 = one core). */
  maxCpuPercent: number;
  /** Max aggregate RSS for all agent processes in MB. */
  maxMemoryMb: number;
  testCommand: string;
  lintCommand: string;
  buildCommand: string;
  integrationCommand: string;
  requireApproval: boolean;
  autoMerge: boolean;
  autoDebug: boolean;
  maxTaskAttempts: number;
  defaultModel: string;
  defaultRuntime: RuntimeKind;
}

export type ProjectStatus = 'idle' | 'planning' | 'running' | 'paused' | 'completed' | 'failed';

export interface Project {
  id: string;
  name: string;
  description: string;
  objective: string;
  status: ProjectStatus;
  repoPath: string;
  settings: ProjectSettings;
  createdAt: number;
  updatedAt: number;
}

export interface Team {
  id: string;
  projectId: string;
  name: string;
  color: string;
  leadAgentId: string | null;
  parentTeamId: string | null;
  collapsed: boolean;
  createdAt: number;
}

export interface Agent {
  id: string;
  projectId: string;
  teamId: string | null;
  parentId: string | null;
  roleId: string;
  name: string;
  status: AgentStatus;
  statusReason: string | null;
  runtime: RuntimeKind;
  model: string;
  branch: string | null;
  workspacePath: string | null;
  priority: number;
  currentTaskId: string | null;
  posX: number | null;
  posY: number | null;
  tokensIn: number;
  tokensOut: number;
  tokenBudget: number;
  costUsd: number;
  cpu: number;
  memMb: number;
  runtimeMs: number;
  startedAt: number | null;
  filesChanged: number;
  testsPassed: number;
  testsFailed: number;
  commits: number;
  retries: number;
  createdAt: number;
  updatedAt: number;
}

/** Steps for the scripted (LLM-free) runtime. All execute for real. */
export type ScriptStep =
  | { type: 'write'; path: string; content: string }
  | { type: 'append'; path: string; content: string }
  | { type: 'run'; command: string; allowFailure?: boolean }
  | { type: 'commit'; message: string }
  | { type: 'message'; to?: string; toRole?: string; team?: boolean; body: string }
  | { type: 'sleep'; ms: number };

export interface TestSummary {
  passed: number;
  failed: number;
  command: string;
  at: number;
}

export interface Task {
  id: string;
  projectId: string;
  title: string;
  description: string;
  priority: number;
  status: TaskStatus;
  assignedAgentId: string | null;
  roleHint: string | null;
  branch: string | null;
  script: ScriptStep[] | null;
  /** Steps a debugger agent applies when this task fails (scripted runtime). */
  recovery: ScriptStep[] | null;
  requiresApproval: boolean;
  attempts: number;
  maxAttempts: number;
  files: string[];
  tests: TestSummary | null;
  result: string | null;
  error: string | null;
  dependsOn: string[];
  createdAt: number;
  startedAt: number | null;
  completedAt: number | null;
  updatedAt: number;
}

export type MessageKind = 'direct' | 'team' | 'broadcast' | 'task' | 'system' | 'user';

export interface Message {
  id: string;
  projectId: string;
  kind: MessageKind;
  fromAgentId: string | null;
  toAgentId: string | null;
  teamId: string | null;
  taskId: string | null;
  body: string;
  meta: Record<string, unknown>;
  createdAt: number;
}

export type LogStream = 'stdout' | 'stderr' | 'system' | 'cmd' | 'agent';

export interface LogLine {
  id: number;
  projectId: string;
  agentId: string | null;
  taskId: string | null;
  stream: LogStream;
  line: string;
  createdAt: number;
}

export interface Link {
  id: string;
  projectId: string;
  sourceAgentId: string;
  targetAgentId: string;
  kind: 'manual';
  createdAt: number;
}

export const MERGE_STEPS = ['tests', 'conflicts', 'lint', 'build', 'integration', 'approval', 'merge'] as const;
export type MergeStep = (typeof MERGE_STEPS)[number];
export type CheckStatus = 'pending' | 'running' | 'passed' | 'failed' | 'skipped';

export type MergeStatus =
  | 'queued'
  | 'checking'
  | 'awaiting_approval'
  | 'merging'
  | 'merged'
  | 'failed'
  | 'conflict'
  | 'rejected';

export interface MergeRequest {
  id: string;
  projectId: string;
  agentId: string | null;
  taskId: string | null;
  branch: string;
  status: MergeStatus;
  checks: Record<MergeStep, { status: CheckStatus; detail?: string; durationMs?: number }>;
  conflictFiles: string[];
  mergedCommit: string | null;
  error: string | null;
  createdAt: number;
  updatedAt: number;
}

export type ApprovalKind = 'command' | 'merge' | 'spawn';
export type ApprovalStatus = 'pending' | 'approved' | 'denied';

export interface Approval {
  id: string;
  projectId: string;
  agentId: string | null;
  kind: ApprovalKind;
  payload: Record<string, unknown>;
  status: ApprovalStatus;
  reason: string;
  createdAt: number;
  resolvedAt: number | null;
}

export interface CommitInfo {
  hash: string;
  shortHash: string;
  author: string;
  message: string;
  date: number;
  branch?: string;
}

export interface BranchInfo {
  name: string;
  head: string;
  agentId: string | null;
  ahead: number;
  behind: number;
  merged: boolean;
  lastCommit: CommitInfo | null;
  mergeStatus: MergeStatus | null;
}

export interface FileChange {
  path: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed' | 'untracked';
  additions: number;
  deletions: number;
  staged: boolean;
  committed: boolean;
}

export interface AgentGitState {
  branch: string | null;
  base: string;
  workspacePath: string | null;
  commits: CommitInfo[];
  changes: FileChange[];
  uncommitted: FileChange[];
  mergeStatus: MergeStatus | null;
}

export interface ResourceSnapshot {
  at: number;
  hostCpuPercent: number;
  hostMemUsedMb: number;
  hostMemTotalMb: number;
  agentCpuPercent: number;
  agentMemMb: number;
  runningProcesses: number;
  activeAgents: number;
  runningTasks: number;
  queuedTasks: number;
  tokensTotal: number;
  costUsd: number;
}

export interface ProjectMetrics {
  activeAgents: number;
  totalAgents: number;
  completedTasks: number;
  runningTasks: number;
  failedTasks: number;
  blockedTasks: number;
  reviewTasks: number;
  queuedTasks: number;
  totalTasks: number;
  tokens: number;
  costUsd: number;
  cpu: number;
  memMb: number;
  build: 'passing' | 'failing' | 'unknown' | 'running';
  tests: 'passing' | 'failing' | 'unknown' | 'running';
  branches: number;
  commits: number;
  uptimeMs: number;
}

export interface ProjectSnapshot {
  project: Project;
  teams: Team[];
  agents: Agent[];
  tasks: Task[];
  messages: Message[];
  links: Link[];
  merges: MergeRequest[];
  approvals: Approval[];
  metrics: ProjectMetrics;
  resources: ResourceSnapshot | null;
}

export interface SystemInfo {
  version: string;
  platform: string;
  node: string;
  executor: 'local' | 'docker';
  runtimes: { kind: RuntimeKind; available: boolean; reason?: string }[];
  llmConfigured: boolean;
  defaultModel: string;
  startedAt: number;
}

export interface SearchResult {
  type: 'agent' | 'task' | 'branch' | 'file' | 'commit' | 'message' | 'error' | 'project';
  id: string;
  title: string;
  subtitle: string;
  projectId: string;
  agentId?: string;
}
