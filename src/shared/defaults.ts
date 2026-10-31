import type { ProjectSettings } from './types.js';
import { DEFAULT_MODEL } from './roles.js';

export const DEFAULT_PROJECT_SETTINGS: ProjectSettings = {
  maxAgents: 100,
  maxConcurrentTasks: 8,
  maxCpuPercent: 400,
  maxMemoryMb: 8192,
  testCommand: 'npm test',
  lintCommand: '',
  buildCommand: '',
  integrationCommand: '',
  requireApproval: false,
  autoMerge: true,
  autoDebug: true,
  maxTaskAttempts: 2,
  defaultModel: DEFAULT_MODEL,
  defaultRuntime: 'claude',
};

export const TEAM_COLORS = ['#60a5fa', '#a78bfa', '#34d399', '#f472b6', '#fbbf24', '#22d3ee', '#fb923c', '#f87171', '#a3e635', '#c084fc'];
