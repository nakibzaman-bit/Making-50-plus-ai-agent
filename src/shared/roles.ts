import type { Permission, ResourceLimits, RoleDefinition } from './types.js';

export const DEFAULT_MODEL = 'claude-opus-5-5';

const BASE_LIMITS: ResourceLimits = {
  commandTimeoutSec: 180,
  maxMemoryMb: 2048,
  maxIterations: 40,
  tokenBudget: 2_000_000,
};

const CODER: Permission[] = ['fs.read', 'fs.write', 'exec', 'git.commit', 'merge.request'];
const LEAD: Permission[] = [...CODER, 'agents.spawn', 'tasks.create', 'messages.broadcast'];
const READER: Permission[] = ['fs.read', 'exec'];

const CODER_TOOLS = [
  'list_files',
  'read_file',
  'write_file',
  'edit_file',
  'run_command',
  'git_status',
  'git_commit',
  'send_message',
  'complete_task',
];
const LEAD_TOOLS = [...CODER_TOOLS, 'spawn_agent', 'create_task'];
const READER_TOOLS = ['list_files', 'read_file', 'run_command', 'git_status', 'send_message', 'complete_task'];

const SHARED_RULES = `
You are one agent inside NEXUS, a multi-agent software workspace. You work ONLY inside your own
git worktree (your current directory); other agents work on other branches in parallel.
Rules:
- Make small, focused, working changes. Run the relevant tests before you finish.
- Commit your work with git_commit and a clear message when a coherent unit is done.
- Use send_message to tell teammates about interface changes they depend on.
- Never try to escape the workspace, read secrets, or use the network unless permitted.
- When finished call complete_task with a short summary; if you cannot finish, call complete_task with success=false and the reason.`;

interface RoleSeed {
  id: string;
  name: string;
  icon: string;
  color: string;
  description: string;
  focus: string;
  capabilities: string[];
  taskTypes: string[];
  kind: 'coder' | 'lead' | 'reader';
  priority?: number;
  limits?: Partial<ResourceLimits>;
  extraPermissions?: Permission[];
}

const SEEDS: RoleSeed[] = [
  { id: 'orchestrator', name: 'Orchestrator', icon: '👑', color: '#a78bfa', kind: 'lead', priority: 10,
    description: 'The brain: decomposes objectives, spawns agents, resolves dependencies, merges.',
    focus: 'Break the objective into a dependency graph of tasks, staff teams, monitor progress, recover from failures and merge finished work.',
    capabilities: ['planning', 'delegation', 'monitoring', 'merging'], taskTypes: ['plan', 'coordinate'] },
  { id: 'team-lead', name: 'Team Lead', icon: '🧭', color: '#818cf8', kind: 'lead', priority: 8,
    description: 'Leads a team, splits its work into sub-tasks and spawns sub-agents.',
    focus: 'Own your team\'s slice of the objective, split it into parallelisable sub-tasks and review sub-agent output.',
    capabilities: ['planning', 'review', 'delegation'], taskTypes: ['coordinate', 'review'] },
  { id: 'project-manager', name: 'Project Manager', icon: '📋', color: '#60a5fa', kind: 'lead', priority: 7,
    description: 'Tracks scope, milestones and acceptance criteria.',
    focus: 'Write clear acceptance criteria, keep the task board accurate and the changelog current.',
    capabilities: ['planning', 'documentation'], taskTypes: ['plan', 'docs'] },
  { id: 'architect', name: 'Architect', icon: '🏛️', color: '#38bdf8', kind: 'lead', priority: 8,
    description: 'Designs module boundaries, interfaces and data flow.',
    focus: 'Define interfaces and module structure first so others can build in parallel; document decisions.',
    capabilities: ['design', 'interfaces', 'review'], taskTypes: ['design', 'scaffold'] },
  { id: 'frontend', name: 'Frontend Engineer', icon: '🎨', color: '#f472b6', kind: 'coder',
    description: 'Builds UI components, state and client integration.',
    focus: 'Build accessible, responsive UI components and wire them to APIs.',
    capabilities: ['react', 'css', 'state'], taskTypes: ['ui', 'frontend'] },
  { id: 'backend', name: 'Backend Engineer', icon: '⚙️', color: '#34d399', kind: 'coder',
    description: 'Implements services, business logic and persistence integration.',
    focus: 'Implement robust server-side logic with input validation and tests.',
    capabilities: ['node', 'services', 'validation'], taskTypes: ['backend', 'service'] },
  { id: 'database', name: 'Database Engineer', icon: '🗄️', color: '#2dd4bf', kind: 'coder',
    description: 'Designs schemas, migrations and queries.',
    focus: 'Design normalised schemas, safe migrations and efficient queries.',
    capabilities: ['sql', 'migrations', 'indexing'], taskTypes: ['database', 'schema'] },
  { id: 'api', name: 'API Engineer', icon: '🔌', color: '#4ade80', kind: 'coder',
    description: 'Designs and implements HTTP/RPC APIs and contracts.',
    focus: 'Design consistent API contracts, implement endpoints and contract tests.',
    capabilities: ['rest', 'contracts', 'openapi'], taskTypes: ['api', 'endpoint'] },
  { id: 'ai', name: 'AI Engineer', icon: '🤖', color: '#c084fc', kind: 'coder',
    description: 'Integrates LLMs, agents, prompts and evaluation.',
    focus: 'Build reliable LLM integrations with clear prompts, tool schemas and evaluations.',
    capabilities: ['llm', 'prompting', 'agents'], taskTypes: ['ai', 'agents'] },
  { id: 'ml', name: 'Machine Learning Engineer', icon: '🧬', color: '#e879f9', kind: 'coder',
    description: 'Builds models, training pipelines and inference code.',
    focus: 'Implement reproducible data pipelines, models and metrics.',
    capabilities: ['training', 'inference', 'metrics'], taskTypes: ['ml', 'model'] },
  { id: 'game', name: 'Game Engineer', icon: '🎮', color: '#fb923c', kind: 'coder',
    description: 'Implements gameplay systems, loops and game state.',
    focus: 'Implement deterministic, testable gameplay systems and the main loop.',
    capabilities: ['gameplay', 'state-machines', 'input'], taskTypes: ['game', 'gameplay'] },
  { id: '3d', name: '3D Engineer', icon: '🧊', color: '#fbbf24', kind: 'coder',
    description: 'Builds 3D scenes, cameras, assets pipelines.',
    focus: 'Build performant 3D scenes with clean scene graphs and asset loading.',
    capabilities: ['three.js', 'webgl', 'scenes'], taskTypes: ['3d', 'scene'] },
  { id: 'physics', name: 'Physics Engineer', icon: '🧲', color: '#f59e0b', kind: 'coder',
    description: 'Implements physics simulation, collisions and integrators.',
    focus: 'Implement stable, deterministic physics with unit-tested integrators and collisions.',
    capabilities: ['simulation', 'collision', 'math'], taskTypes: ['physics'] },
  { id: 'graphics', name: 'Graphics Engineer', icon: '✨', color: '#facc15', kind: 'coder',
    description: 'Shaders, rendering pipelines and visual effects.',
    focus: 'Write efficient shaders and rendering passes with graceful fallbacks.',
    capabilities: ['shaders', 'rendering', 'vfx'], taskTypes: ['graphics', 'shader'] },
  { id: 'designer', name: 'UI/UX Designer', icon: '🖌️', color: '#fb7185', kind: 'coder',
    description: 'Design systems, layout, interaction and accessibility.',
    focus: 'Create a coherent design system: tokens, spacing, typography, accessible interactions.',
    capabilities: ['design-systems', 'a11y', 'ux'], taskTypes: ['design', 'ux'] },
  { id: 'animation', name: 'Animation Engineer', icon: '🎞️', color: '#f9a8d4', kind: 'coder',
    description: 'Motion design, transitions and animation systems.',
    focus: 'Implement smooth, performant, interruptible animations that respect reduced-motion.',
    capabilities: ['motion', 'easing', 'timelines'], taskTypes: ['animation'] },
  { id: 'security', name: 'Security Engineer', icon: '🛡️', color: '#ef4444', kind: 'coder', priority: 7,
    description: 'Threat modelling, hardening and security review.',
    focus: 'Find and fix vulnerabilities: input validation, authz, secrets handling, dependency risk.',
    capabilities: ['threat-modeling', 'audit', 'hardening'], taskTypes: ['security', 'audit'] },
  { id: 'devops', name: 'DevOps Engineer', icon: '🚀', color: '#22d3ee', kind: 'coder',
    description: 'Build pipelines, CI, packaging and deployment.',
    focus: 'Make builds reproducible and fast; write CI and release scripts.',
    capabilities: ['ci', 'build', 'release'], taskTypes: ['devops', 'build', 'ci'] },
  { id: 'cloud', name: 'Cloud Engineer', icon: '☁️', color: '#7dd3fc', kind: 'coder',
    description: 'Infrastructure as code and cloud architecture.',
    focus: 'Write least-privilege, reproducible infrastructure definitions.',
    capabilities: ['iac', 'networking', 'scaling'], taskTypes: ['cloud', 'infra'] },
  { id: 'test', name: 'Test Engineer', icon: '🧪', color: '#a3e635', kind: 'coder',
    description: 'Writes unit, integration and end-to-end tests.',
    focus: 'Write meaningful tests that pin behaviour; run them and report results precisely.',
    capabilities: ['unit-tests', 'integration-tests', 'e2e'], taskTypes: ['test', 'testing'] },
  { id: 'qa', name: 'QA Engineer', icon: '✅', color: '#84cc16', kind: 'coder',
    description: 'Verifies features end-to-end against acceptance criteria.',
    focus: 'Verify behaviour against acceptance criteria; file precise, reproducible defects.',
    capabilities: ['verification', 'exploratory', 'regression'], taskTypes: ['qa', 'verify'] },
  { id: 'debugger', name: 'Debugger', icon: '🐞', color: '#f87171', kind: 'coder', priority: 9,
    description: 'Diagnoses failures from logs and tests, applies minimal fixes.',
    focus: 'Reproduce the failure, find the root cause from logs/tests, apply the minimal fix and prove it with a passing test.',
    capabilities: ['diagnosis', 'root-cause', 'fixes'], taskTypes: ['debug', 'fix'] },
  { id: 'reviewer', name: 'Code Reviewer', icon: '🔍', color: '#94a3b8', kind: 'reader', priority: 6,
    description: 'Reviews diffs for correctness, clarity and risk.',
    focus: 'Review changes for correctness, security and maintainability; message authors with concrete requests.',
    capabilities: ['review', 'static-analysis'], taskTypes: ['review'] },
  { id: 'docs', name: 'Documentation Agent', icon: '📚', color: '#cbd5e1', kind: 'coder', priority: 3,
    description: 'Writes READMEs, guides and API reference.',
    focus: 'Write accurate, concise docs that match the code as it is.',
    capabilities: ['writing', 'api-docs'], taskTypes: ['docs'] },
  { id: 'performance', name: 'Performance Engineer', icon: '⚡', color: '#fde047', kind: 'coder',
    description: 'Profiles and optimises hot paths, bundle size and memory.',
    focus: 'Measure first, then optimise; add benchmarks that prove the improvement.',
    capabilities: ['profiling', 'benchmarks', 'optimisation'], taskTypes: ['performance', 'benchmark'] },
  { id: 'research', name: 'Research Agent', icon: '🔭', color: '#93c5fd', kind: 'reader', priority: 4,
    description: 'Investigates options, prior art and libraries; writes findings.',
    focus: 'Investigate options and summarise trade-offs with a clear recommendation.',
    capabilities: ['research', 'analysis'], taskTypes: ['research'], extraPermissions: ['fs.write', 'git.commit'] },
  { id: 'marketing', name: 'Marketing Agent', icon: '📣', color: '#fda4af', kind: 'reader', priority: 2,
    description: 'Writes product copy, release notes and landing content.',
    focus: 'Write clear, honest product copy and release notes from the actual feature set.',
    capabilities: ['copywriting', 'release-notes'], taskTypes: ['marketing', 'copy'], extraPermissions: ['fs.write', 'git.commit'] },
];

function build(seed: RoleSeed): RoleDefinition {
  const perms = seed.kind === 'lead' ? LEAD : seed.kind === 'coder' ? CODER : READER;
  const tools = seed.kind === 'lead' ? LEAD_TOOLS : seed.kind === 'coder' ? CODER_TOOLS : READER_TOOLS;
  const permissions = Array.from(new Set([...perms, ...(seed.extraPermissions ?? [])]));
  const finalTools = Array.from(
    new Set([
      ...tools,
      ...(permissions.includes('fs.write') ? ['write_file', 'edit_file'] : []),
      ...(permissions.includes('git.commit') ? ['git_commit'] : []),
    ]),
  );
  return {
    id: seed.id,
    name: seed.name,
    icon: seed.icon,
    color: seed.color,
    description: seed.description,
    systemPrompt: `You are the ${seed.name}. ${seed.focus}\n${SHARED_RULES}`,
    capabilities: seed.capabilities,
    tools: finalTools,
    permissions,
    preferredModel: DEFAULT_MODEL,
    taskTypes: seed.taskTypes,
    priority: seed.priority ?? 5,
    limits: { ...BASE_LIMITS, ...seed.limits },
    builtin: true,
  };
}

export const BUILTIN_ROLES: RoleDefinition[] = SEEDS.map(build);

export const BUILTIN_ROLE_IDS = new Set(BUILTIN_ROLES.map((r) => r.id));

export function findRole(roles: RoleDefinition[], id: string): RoleDefinition | undefined {
  return roles.find((r) => r.id === id);
}
