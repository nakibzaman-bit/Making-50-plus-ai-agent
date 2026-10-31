import type { Message, MessageKind } from '../../shared/types.js';
import type { Core } from '../core.js';
import { id, now } from '../util.js';

export interface SendInput {
  kind: MessageKind;
  fromAgentId?: string | null;
  toAgentId?: string | null;
  teamId?: string | null;
  taskId?: string | null;
  body: string;
  meta?: Record<string, unknown>;
}

/** Agent ↔ agent, team, broadcast, task, system and user messages. */
export class MessageService {
  constructor(private core: Core) {}

  send(projectId: string, input: SendInput): Message {
    const message: Message = {
      id: id('msg'),
      projectId,
      kind: input.kind,
      fromAgentId: input.fromAgentId ?? null,
      toAgentId: input.toAgentId ?? null,
      teamId: input.teamId ?? null,
      taskId: input.taskId ?? null,
      body: input.body.slice(0, 8000),
      meta: input.meta ?? {},
      createdAt: now(),
    };
    this.core.repos.messages.insert(message);
    this.core.bus.emit({ type: 'message.created', projectId, message });
    return message;
  }

  system(projectId: string, body: string, extra: Partial<SendInput> = {}): Message {
    return this.send(projectId, { kind: 'system', body, ...extra });
  }

  list(projectId: string, limit = 300): Message[] {
    return this.core.repos.messages.where('project_id = ? ORDER BY created_at DESC LIMIT ?', projectId, limit).reverse();
  }

  forAgent(agentId: string, limit = 200): Message[] {
    return this.core.repos.messages
      .where('(from_agent_id = ? OR to_agent_id = ?) ORDER BY created_at DESC LIMIT ?', agentId, agentId, limit)
      .reverse();
  }

  /** Messages an agent should read: direct, its team, broadcasts and user messages, after a time. */
  inbox(projectId: string, agentId: string, teamId: string | null, since: number): Message[] {
    return this.core.repos.messages.where(
      `project_id = ? AND created_at > ? AND (from_agent_id IS NULL OR from_agent_id != ?) AND (
        to_agent_id = ? OR (kind = 'team' AND team_id = ?) OR kind = 'broadcast')
       ORDER BY created_at`,
      projectId, since, agentId, agentId, teamId ?? '__none__',
    );
  }
}
