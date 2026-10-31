import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import type { RoleDefinition } from '../../shared/types.js';

export interface PlanAgent {
  key: string;
  roleId: string;
  name: string;
  team: string;
  lead?: boolean;
  /** Key of the agent this one reports to (sub-agent hierarchy). */
  reportsTo?: string;
}

export interface PlanTask {
  key: string;
  title: string;
  description: string;
  agent: string;
  dependsOn: string[];
  priority: number;
  requiresApproval?: boolean;
}

export interface Plan {
  summary: string;
  planner: 'llm' | 'heuristic';
  teams: { name: string }[];
  agents: PlanAgent[];
  tasks: PlanTask[];
}

export interface Planner {
  readonly kind: 'llm' | 'heuristic';
  plan(objective: string, roles: RoleDefinition[]): Promise<Plan>;
}

const PlanSchema = z.object({
  summary: z.string(),
  teams: z.array(z.object({ name: z.string() })).min(1),
  agents: z
    .array(z.object({ key: z.string(), roleId: z.string(), name: z.string(), team: z.string(), lead: z.boolean().optional(), reportsTo: z.string().optional() }))
    .min(1)
    .max(120),
  tasks: z
    .array(z.object({ key: z.string(), title: z.string(), description: z.string(), agent: z.string(), dependsOn: z.array(z.string()), priority: z.number(), requiresApproval: z.boolean().optional() }))
    .min(1)
    .max(300),
});

/** Validates references and removes dependency cycles/dangling edges from any plan. */
export function sanitizePlan(plan: Omit<Plan, 'planner'>, roles: RoleDefinition[], planner: Plan['planner']): Plan {
  const roleIds = new Set(roles.map((r) => r.id));
  const agents = plan.agents.map((a) => ({ ...a, roleId: roleIds.has(a.roleId) ? a.roleId : 'backend' }));
  const agentKeys = new Set(agents.map((a) => a.key));
  const teams = Array.from(new Set([...plan.teams.map((t) => t.name), ...agents.map((a) => a.team)])).map((name) => ({ name }));
  const taskKeys = new Set(plan.tasks.map((t) => t.key));
  const tasks = plan.tasks
    .filter((t) => agentKeys.has(t.agent))
    .map((t) => ({ ...t, priority: Math.max(0, Math.min(10, Math.round(t.priority))), dependsOn: t.dependsOn.filter((d) => taskKeys.has(d) && d !== t.key) }));
  // Break cycles: keep an edge only if its target is earlier in a DFS topological order.
  const byKey = new Map(tasks.map((t) => [t.key, t]));
  const state = new Map<string, 'visiting' | 'done'>();
  const visit = (k: string) => {
    state.set(k, 'visiting');
    const t = byKey.get(k)!;
    t.dependsOn = t.dependsOn.filter((d) => {
      if (state.get(d) === 'visiting') return false;
      if (!state.has(d)) visit(d);
      return true;
    });
    state.set(k, 'done');
  };
  for (const t of tasks) if (!state.has(t.key)) visit(t.key);
  return { summary: plan.summary, planner, teams, agents, tasks };
}

/** Claude decomposes the objective into teams, agents and a task DAG (structured output). */
export class LlmPlanner implements Planner {
  readonly kind = 'llm' as const;
  private client: Anthropic;

  constructor(apiKey: string, private model: string) {
    this.client = new Anthropic({ apiKey, maxRetries: 2 });
  }

  async plan(objective: string, roles: RoleDefinition[]): Promise<Plan> {
    const roleList = roles.map((r) => `- ${r.id}: ${r.name} — ${r.description}`).join('\n');
    const schema = {
      type: 'object',
      additionalProperties: false,
      required: ['summary', 'teams', 'agents', 'tasks'],
      properties: {
        summary: { type: 'string' },
        teams: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['name'], properties: { name: { type: 'string' } } } },
        agents: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['key', 'roleId', 'name', 'team', 'lead', 'reportsTo'],
            properties: { key: { type: 'string' }, roleId: { type: 'string' }, name: { type: 'string' }, team: { type: 'string' }, lead: { type: 'boolean' }, reportsTo: { type: 'string' } },
          },
        },
        tasks: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['key', 'title', 'description', 'agent', 'dependsOn', 'priority', 'requiresApproval'],
            properties: {
              key: { type: 'string' },
              title: { type: 'string' },
              description: { type: 'string' },
              agent: { type: 'string' },
              dependsOn: { type: 'array', items: { type: 'string' } },
              priority: { type: 'integer' },
              requiresApproval: { type: 'boolean' },
            },
          },
        },
      },
    };
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 16000,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'high', format: { type: 'json_schema', schema } },
      system:
        'You are the orchestrator of a team of AI software agents that work in parallel on separate git branches of one repository. ' +
        'Plan the work so it parallelises well: an architecture/scaffold task first, then independent feature tasks, then tests, review, security and build. ' +
        'Each task must be completable by one agent in one session and must leave the repository with passing tests. ' +
        'Use only the given role ids. Group agents into teams, mark one lead per team (reportsTo = "" for leads, otherwise the lead key). ' +
        'Task descriptions must state concrete files/modules and acceptance criteria. Priorities are 0-10.',
      messages: [{ role: 'user', content: `Objective:\n${objective}\n\nAvailable roles:\n${roleList}\n\nProduce the plan.` }],
    });
    if (response.stop_reason === 'refusal') throw new Error('Planner request was declined by the model');
    const text = response.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
    const parsed = PlanSchema.parse(JSON.parse(text));
    const agents = parsed.agents.map((a) => ({ ...a, reportsTo: a.reportsTo || undefined }));
    return sanitizePlan({ ...parsed, agents }, roles, 'llm');
  }
}

interface TemplateMember {
  role: string;
  name: string;
  task: string;
  detail: string;
  after?: string[];
  approval?: boolean;
}
interface Template {
  match: RegExp;
  summary: string;
  teams: { name: string; lead: TemplateMember; members: TemplateMember[] }[];
}

const m = (role: string, name: string, task: string, detail: string, after?: string[], approval?: boolean): TemplateMember => ({ role, name, task, detail, after, approval });

const TEMPLATES: Template[] = [
  {
    match: /\b(football|soccer|game|gameplay|racing|shooter|platformer|rpg)\b/i,
    summary: 'Game project: direction & architecture, core gameplay and physics, AI opponents, presentation (3D/animation/audio/UI), online systems, then QA/performance/security and a release build.',
    teams: [
      { name: 'Direction', lead: m('architect', 'Game Director', 'Game design & architecture', 'Write docs/DESIGN.md and scaffold src/ modules (game loop, state, input, render, audio, net) with interfaces and a passing smoke test.'), members: [] },
      {
        name: 'Gameplay',
        lead: m('team-lead', 'Gameplay Lead', 'Gameplay breakdown', 'Split gameplay into rules, match flow and controls; define acceptance tests.', ['Game Director']),
        members: [
          m('game', 'Gameplay Engineer', 'Match rules & game loop', 'Implement match state machine (kick-off, play, goal, half-time, full-time) with unit tests.', ['Gameplay Lead']),
          m('physics', 'Player Physics Agent', 'Player movement physics', 'Deterministic player movement: acceleration, turning, collisions; tested integrator.', ['Gameplay Lead']),
          m('physics', 'Football Physics Agent', 'Ball physics', 'Ball flight, spin, bounce, friction, and goal-line detection with tests.', ['Gameplay Lead']),
        ],
      },
      {
        name: 'AI',
        lead: m('ai', 'AI Opponent Agent', 'Team AI', 'Opponent tactics: formations, positioning, passing decisions; testable decision functions.', ['Gameplay Engineer']),
        members: [m('ai', 'Goalkeeper AI Agent', 'Goalkeeper AI', 'Goalkeeper positioning and save decisions with scenario tests.', ['AI Opponent Agent', 'Football Physics Agent'])],
      },
      {
        name: 'Presentation',
        lead: m('3d', '3D Environment Agent', '3D scene & camera', 'Scene graph, broadcast camera, lighting; renderer abstraction with headless tests.', ['Game Director']),
        members: [
          m('3d', 'Stadium Agent', 'Stadium & pitch', 'Procedural pitch markings and stadium geometry.', ['3D Environment Agent']),
          m('animation', 'Animation Agent', 'Player animation system', 'Animation state machine (run, kick, tackle, celebrate) blending.', ['Player Physics Agent']),
          m('frontend', 'UI Agent', 'HUD & menus', 'Scoreboard, timer, menus, pause screen; accessible UI components.', ['Gameplay Engineer']),
          m('backend', 'Audio Agent', 'Audio engine', 'Audio mixer with crowd, ball and whistle events.', ['Game Director']),
          m('ai', 'Commentary Agent', 'Live commentary', 'Event-driven commentary generator from match events.', ['Gameplay Engineer', 'Audio Agent']),
        ],
      },
      {
        name: 'Online',
        lead: m('backend', 'Multiplayer Agent', 'Multiplayer sessions', 'Lobby and session management with deterministic lockstep.', ['Gameplay Engineer']),
        members: [
          m('api', 'Networking Agent', 'Netcode', 'Input sync protocol, rollback/prediction, latency simulation tests.', ['Multiplayer Agent']),
          m('database', 'Database Agent', 'Player profiles DB', 'Schema + repository for profiles, stats and leaderboards.', ['Game Director']),
          m('backend', 'Save System Agent', 'Save/load system', 'Versioned save files with migration tests.', ['Database Agent']),
        ],
      },
      {
        name: 'Quality',
        lead: m('qa', 'QA Agent', 'End-to-end match QA', 'Scripted full-match simulation tests covering rules, AI and saves.', ['Goalkeeper AI Agent', 'Save System Agent', 'UI Agent']),
        members: [
          m('performance', 'Performance Agent', 'Frame budget & profiling', 'Benchmarks for simulation step and render; keep 60 FPS budget.', ['QA Agent']),
          m('security', 'Security Agent', 'Security review', 'Review netcode and save files for tampering/injection; fix issues.', ['Networking Agent'], true),
          m('devops', 'Build Agent', 'Release build', 'Production build script, CI workflow and packaged artifact.', ['Performance Agent', 'Security Agent']),
        ],
      },
    ],
  },
  {
    match: /\b(e-?commerce|shop|store|cart|checkout|marketplace)\b/i,
    summary: 'E-commerce platform: architecture and data model, catalogue/cart/checkout/payments, auth and admin, then security, tests, DevOps and docs.',
    teams: [
      { name: 'Platform', lead: m('architect', 'Architect', 'System architecture', 'Monorepo layout, API contracts (OpenAPI), shared types, CI-ready test setup.'), members: [m('database', 'Database Agent', 'Data model & migrations', 'Products, users, carts, orders, payments schema + migrations.', ['Architect'])] },
      {
        name: 'Commerce',
        lead: m('backend', 'Backend Agent', 'Core API service', 'HTTP service skeleton, validation, error handling, health checks.', ['Architect']),
        members: [
          m('backend', 'Authentication Agent', 'Authentication', 'Signup/login, sessions, password hashing, RBAC.', ['Backend Agent', 'Database Agent'], true),
          m('api', 'Product Agent', 'Product catalogue API', 'CRUD + listing with filters and pagination.', ['Backend Agent', 'Database Agent']),
          m('api', 'Cart Agent', 'Cart service', 'Cart operations with stock reservation.', ['Product Agent']),
          m('api', 'Checkout Agent', 'Checkout flow', 'Order creation, totals, tax and shipping rules.', ['Cart Agent', 'Authentication Agent']),
          m('backend', 'Payment Agent', 'Payments integration', 'Payment provider abstraction with sandbox adapter and webhooks.', ['Checkout Agent'], true),
          m('backend', 'Search Agent', 'Product search', 'Full-text search with ranking and facets.', ['Product Agent']),
        ],
      },
      {
        name: 'Experience',
        lead: m('frontend', 'UI Agent', 'Storefront UI', 'Product list/detail, cart drawer, checkout pages; responsive.', ['Product Agent']),
        members: [m('frontend', 'Admin Agent', 'Admin dashboard', 'Inventory and order management UI.', ['UI Agent', 'Authentication Agent'])],
      },
      {
        name: 'Quality & Ops',
        lead: m('test', 'Testing Agent', 'Integration & E2E tests', 'End-to-end purchase journey tests.', ['Payment Agent', 'Admin Agent', 'Search Agent']),
        members: [
          m('security', 'Security Agent', 'Security audit', 'Authz checks, input validation, payment webhook verification.', ['Payment Agent', 'Authentication Agent'], true),
          m('devops', 'DevOps Agent', 'CI/CD & deployment', 'CI pipeline, container build, environment config.', ['Testing Agent']),
          m('docs', 'Documentation Agent', 'Documentation', 'README, API reference, operations runbook.', ['Testing Agent']),
        ],
      },
    ],
  },
  {
    match: /\b(ai|assistant|chatbot|llm|agent|rag)\b/i,
    summary: 'AI assistant: architecture, LLM integration with tools and retrieval, API and UI, evaluation, security and release.',
    teams: [
      { name: 'Core', lead: m('architect', 'Architect', 'Assistant architecture', 'Module layout: conversation, tools, retrieval, API, UI; interfaces and smoke test.'), members: [] },
      {
        name: 'Intelligence',
        lead: m('ai', 'AI Lead', 'LLM orchestration', 'Conversation loop with tool use and streaming.', ['Architect']),
        members: [
          m('ai', 'Tools Agent', 'Tool integrations', 'Typed tool registry with validation and tests.', ['AI Lead']),
          m('ml', 'Retrieval Agent', 'Retrieval pipeline', 'Chunking, embeddings interface, ranking with fixture tests.', ['Architect']),
          m('ai', 'Evaluation Agent', 'Evaluation harness', 'Golden-set evals with scoring and regression report.', ['AI Lead', 'Retrieval Agent']),
        ],
      },
      {
        name: 'Product',
        lead: m('api', 'API Agent', 'Assistant API', 'Chat + history endpoints with rate limiting.', ['AI Lead']),
        members: [m('frontend', 'UI Agent', 'Chat UI', 'Streaming chat UI with citations.', ['API Agent']), m('database', 'Database Agent', 'Conversation storage', 'Schema and repository for conversations.', ['Architect'])],
      },
      {
        name: 'Quality',
        lead: m('test', 'Test Agent', 'Integration tests', 'End-to-end conversation tests with mocked model.', ['UI Agent', 'Evaluation Agent']),
        members: [m('security', 'Security Agent', 'Prompt-injection & data review', 'Threat model and mitigations for tools and retrieval.', ['Tools Agent'], true), m('docs', 'Documentation Agent', 'Docs', 'Setup and usage docs.', ['Test Agent'])],
      },
    ],
  },
  {
    match: /\b(mobile|ios|android|react native|flutter)\b/i,
    summary: 'Mobile app: architecture, screens and navigation, offline data and sync, API, tests and release build.',
    teams: [
      { name: 'Core', lead: m('architect', 'Architect', 'App architecture', 'Navigation, state, data layer interfaces and smoke test.'), members: [] },
      {
        name: 'App',
        lead: m('frontend', 'Mobile Lead', 'Screens & navigation', 'Primary screens with navigation and accessibility.', ['Architect']),
        members: [m('designer', 'UI/UX Designer', 'Design system', 'Tokens, components, dark mode.', ['Architect']), m('animation', 'Animation Agent', 'Transitions', 'Screen transitions and micro-interactions.', ['Mobile Lead'])],
      },
      {
        name: 'Data',
        lead: m('backend', 'Backend Agent', 'API service', 'REST API for the app with validation.', ['Architect']),
        members: [m('database', 'Database Agent', 'Offline storage & sync', 'Local DB with sync and conflict resolution.', ['Backend Agent'])],
      },
      { name: 'Quality', lead: m('qa', 'QA Agent', 'Device QA', 'Flow tests across screen sizes.', ['Mobile Lead', 'Database Agent']), members: [m('devops', 'Release Agent', 'Release build', 'Build pipeline and store-ready artifacts.', ['QA Agent'])] },
    ],
  },
  {
    match: /.*/,
    summary: 'Web application: architecture, backend and data, frontend, then tests, review, security, docs and build.',
    teams: [
      { name: 'Core', lead: m('architect', 'Architect', 'Architecture & scaffold', 'Project structure, interfaces, test setup with a passing smoke test.'), members: [m('project-manager', 'Project Manager', 'Scope & acceptance criteria', 'docs/REQUIREMENTS.md with acceptance criteria per feature.', ['Architect'])] },
      {
        name: 'Engineering',
        lead: m('team-lead', 'Engineering Lead', 'Engineering breakdown', 'Break features into parallel tasks; define module boundaries.', ['Architect']),
        members: [
          m('backend', 'Backend Agent', 'Backend services', 'Business logic and API endpoints with tests.', ['Engineering Lead']),
          m('database', 'Database Agent', 'Data layer', 'Schema, migrations, repositories.', ['Engineering Lead']),
          m('frontend', 'Frontend Agent', 'Frontend', 'UI components and pages wired to the API.', ['Backend Agent']),
          m('designer', 'UI/UX Designer', 'Design system', 'Tokens, layout, accessible components.', ['Architect']),
        ],
      },
      {
        name: 'Quality',
        lead: m('test', 'Test Agent', 'Integration tests', 'Integration and end-to-end tests.', ['Frontend Agent', 'Database Agent']),
        members: [
          m('reviewer', 'Code Reviewer', 'Code review', 'Review merged code and report issues to authors.', ['Test Agent']),
          m('security', 'Security Agent', 'Security review', 'Input validation, authz, secrets handling.', ['Backend Agent'], true),
          m('docs', 'Documentation Agent', 'Documentation', 'README and API docs.', ['Test Agent']),
          m('devops', 'DevOps Agent', 'Build & CI', 'Production build and CI workflow.', ['Test Agent', 'Security Agent']),
        ],
      },
    ],
  },
];

/** Deterministic, offline planner from domain templates. Used when no LLM is configured. */
export class HeuristicPlanner implements Planner {
  readonly kind = 'heuristic' as const;

  async plan(objective: string, roles: RoleDefinition[]): Promise<Plan> {
    const tpl = TEMPLATES.find((t) => t.match.test(objective))!;
    const agents: PlanAgent[] = [];
    const tasks: PlanTask[] = [];
    const keyOf = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    for (const team of tpl.teams) {
      const leadKey = keyOf(team.lead.name);
      for (const [i, mem] of [team.lead, ...team.members].entries()) {
        const key = keyOf(mem.name);
        agents.push({ key, roleId: mem.role, name: mem.name, team: team.name, lead: i === 0, reportsTo: i === 0 ? undefined : leadKey });
        tasks.push({
          key: `t-${key}`,
          title: mem.task,
          description: `${mem.detail}\n\nObjective context: ${objective}`,
          agent: key,
          dependsOn: (mem.after ?? []).map((a) => `t-${keyOf(a)}`),
          priority: i === 0 ? 8 : 5,
          requiresApproval: mem.approval,
        });
      }
    }
    return sanitizePlan({ summary: tpl.summary, teams: tpl.teams.map((t) => ({ name: t.name })), agents, tasks }, roles, 'heuristic');
  }
}
