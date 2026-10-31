import type { AgentStatus, MergeStatus, TaskStatus } from '../../shared/types';

export type Tone = 'active' | 'done' | 'wait' | 'fail' | 'comm' | 'idle';

export const TONE_HEX: Record<Tone, string> = {
  active: '#3b82f6',
  done: '#22c55e',
  wait: '#eab308',
  fail: '#ef4444',
  comm: '#a855f7',
  idle: '#64748b',
};

export function agentTone(s: AgentStatus): Tone {
  switch (s) {
    case 'working':
      return 'active';
    case 'completed':
      return 'done';
    case 'waiting':
    case 'queued':
    case 'paused':
      return 'wait';
    case 'failed':
      return 'fail';
    case 'communicating':
      return 'comm';
    default:
      return 'idle';
  }
}

export function taskTone(s: TaskStatus): Tone {
  switch (s) {
    case 'working':
    case 'assigned':
    case 'testing':
      return 'active';
    case 'completed':
      return 'done';
    case 'queued':
    case 'waiting':
    case 'review':
      return 'wait';
    case 'failed':
    case 'blocked':
      return 'fail';
    default:
      return 'idle';
  }
}

export function mergeTone(s: MergeStatus | null | undefined): Tone {
  switch (s) {
    case 'merged':
      return 'done';
    case 'checking':
    case 'merging':
      return 'active';
    case 'queued':
    case 'awaiting_approval':
      return 'wait';
    case 'failed':
    case 'conflict':
    case 'rejected':
      return 'fail';
    default:
      return 'idle';
  }
}

export const AGENT_STATUS_LABEL: Record<AgentStatus, string> = {
  idle: 'IDLE',
  queued: 'QUEUED',
  working: 'WORKING',
  waiting: 'WAITING',
  paused: 'PAUSED',
  communicating: 'COMMUNICATING',
  completed: 'COMPLETED',
  failed: 'FAILED',
  stopped: 'STOPPED',
};
