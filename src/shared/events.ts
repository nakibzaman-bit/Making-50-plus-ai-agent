import type {
  Agent,
  Approval,
  CommitInfo,
  Link,
  LogLine,
  MergeRequest,
  Message,
  Project,
  ProjectMetrics,
  ResourceSnapshot,
  Task,
  Team,
} from './types.js';

/** Every real-time event pushed over the WebSocket. */
export type ServerEvent =
  | { type: 'project.updated'; projectId: string; project: Project }
  | { type: 'project.deleted'; projectId: string }
  | { type: 'team.upserted'; projectId: string; team: Team }
  | { type: 'team.removed'; projectId: string; teamId: string }
  | { type: 'agent.upserted'; projectId: string; agent: Agent }
  | { type: 'agent.removed'; projectId: string; agentId: string }
  | { type: 'task.upserted'; projectId: string; task: Task }
  | { type: 'task.removed'; projectId: string; taskId: string }
  | { type: 'message.created'; projectId: string; message: Message }
  | { type: 'log.batch'; projectId: string; lines: LogLine[] }
  | { type: 'git.commit'; projectId: string; agentId: string | null; branch: string; commit: CommitInfo }
  | { type: 'git.branch'; projectId: string; agentId: string | null; branch: string; action: 'created' | 'deleted' | 'merged' }
  | { type: 'merge.upserted'; projectId: string; merge: MergeRequest }
  | { type: 'approval.upserted'; projectId: string; approval: Approval }
  | { type: 'link.upserted'; projectId: string; link: Link }
  | { type: 'link.removed'; projectId: string; linkId: string }
  | { type: 'metrics.tick'; projectId: string; metrics: ProjectMetrics; resources: ResourceSnapshot }
  | { type: 'orchestrator.log'; projectId: string; line: string; level: 'info' | 'success' | 'warn' | 'error' };

export type ServerEventType = ServerEvent['type'];

/** Client → server WebSocket messages. */
export type ClientMessage = { type: 'subscribe'; projectId: string | null } | { type: 'ping' };
