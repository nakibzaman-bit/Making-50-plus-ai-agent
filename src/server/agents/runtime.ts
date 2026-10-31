import type { Agent, CommitInfo, Message, Project, RoleDefinition, Task } from '../../shared/types.js';
import type { RunResult } from '../process/processManager.js';

export class StopError extends Error {
  constructor(message = 'Agent stopped') {
    super(message);
  }
}

export class BudgetExceededError extends Error {}

/** Cooperative control: runtimes call checkpoint() between steps so pause/stop take effect. */
export interface AgentControl {
  readonly signal: AbortSignal;
  checkpoint(): Promise<void>;
}

export interface MessageTarget {
  /** Agent id or (case-insensitive) agent name. */
  to?: string;
  /** Deliver to the first agent with this role id. */
  toRole?: string;
  team?: boolean;
  broadcast?: boolean;
  body: string;
}

/** Everything a runtime may do — each capability is permission-checked by the runner. */
export interface RuntimeContext {
  project: Project;
  agent: Agent;
  role: RoleDefinition;
  task: Task;
  workspace: string;
  control: AgentControl;
  /** Variables for templating ({{commit}}, {{branch}}, {{agent}}). */
  vars: Record<string, string>;
  /** Extra context for the model: dependency results, failure logs, teammates. */
  briefing: string;
  log(line: string): void;
  run(command: string, opts?: { timeoutSec?: number }): Promise<RunResult>;
  readFile(rel: string): string;
  writeFile(rel: string, content: string): void;
  appendFile(rel: string, content: string): void;
  listFiles(rel?: string): Promise<string[]>;
  gitStatus(): Promise<string>;
  commit(message: string): Promise<CommitInfo | null>;
  sendMessage(target: MessageTarget): Message;
  spawnAgent(input: { roleId: string; name?: string; taskTitle?: string; taskDescription?: string }): Promise<{ agent: Agent; task: Task | null }>;
  createTask(input: { title: string; description?: string; roleHint?: string; assignTo?: string; dependsOn?: string[] }): Task;
  /** New messages for this agent since the last call. */
  inbox(): Message[];
  /** Record model usage; throws BudgetExceededError when over budget. */
  recordUsage(model: string, inputTokens: number, outputTokens: number): void;
}

export interface RunOutcome {
  success: boolean;
  summary: string;
  error?: string;
}

export interface AgentRuntime {
  readonly kind: Agent['runtime'];
  available(): { ok: boolean; reason?: string };
  run(ctx: RuntimeContext): Promise<RunOutcome>;
}
