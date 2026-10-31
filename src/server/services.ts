import { loadConfig, type NexusConfig } from './config.js';
import { Db } from './db/database.js';
import { Repositories } from './db/repositories.js';
import { EventBus } from './events/eventBus.js';
import { LogSink } from './events/logSink.js';
import { GitService } from './git/gitService.js';
import { DockerExecutor, LocalExecutor } from './process/executor.js';
import { ProcessManager } from './process/processManager.js';
import { RoleService } from './roles/roleService.js';
import { MessageService } from './messages/messageService.js';
import { ApprovalService } from './approvals/approvalService.js';
import { ProjectService } from './projects/projectService.js';
import { AgentService } from './agents/agentService.js';
import { TaskService } from './tasks/taskService.js';
import { TeamService } from './teams/teamService.js';
import { MergeQueue } from './merge/mergeQueue.js';
import { AgentRunner } from './agents/agentRunner.js';
import { ScriptedRuntime } from './agents/runtimes/scriptedRuntime.js';
import { ClaudeRuntime, type MessagesClient } from './agents/runtimes/claudeRuntime.js';
import { Orchestrator } from './orchestrator/orchestrator.js';
import { HeuristicPlanner, LlmPlanner, type Planner } from './orchestrator/planner.js';
import { SearchService } from './search/searchService.js';
import type { Core } from './core.js';

export interface ServiceOptions {
  config?: Partial<NexusConfig>;
  /** Inject a fake Anthropic client (tests). */
  claudeClient?: MessagesClient;
  /** Override the LLM planner (tests). */
  llmPlanner?: Planner | null;
}

/** Composition root: builds the whole backend object graph. */
export function createServices(opts: ServiceOptions = {}) {
  const config = loadConfig(opts.config);
  const db = new Db(config.dbPath);
  const repos = new Repositories(db);
  const bus = new EventBus();
  const logs = new LogSink(repos, bus);
  const git = new GitService();
  const executor = config.executor === 'docker' ? new DockerExecutor() : new LocalExecutor();
  const pm = new ProcessManager(executor, logs);
  const core: Core = { config, db, repos, bus, logs, git, pm };

  const roles = new RoleService(core);
  const messages = new MessageService(core);
  const approvals = new ApprovalService(core);
  const projects = new ProjectService(core);
  const agents = new AgentService(core, roles, projects, messages);
  const tasks = new TaskService(core);
  const teams = new TeamService(core);
  const merges = new MergeQueue(core, projects, tasks, agents, approvals);
  const search = new SearchService(core);

  const claude = new ClaudeRuntime(config.anthropicApiKey, opts.claudeClient);
  const scripted = new ScriptedRuntime();
  const llmPlanner = opts.llmPlanner !== undefined ? opts.llmPlanner : config.anthropicApiKey ? new LlmPlanner(config.anthropicApiKey, config.defaultModel) : null;
  const orchestrator = new Orchestrator(core, projects, agents, tasks, messages, roles, teams, merges, { llm: llmPlanner, heuristic: new HeuristicPlanner() });
  const runner = new AgentRunner(core, agents, tasks, messages, approvals, roles, projects, { claude, scripted }, orchestrator);
  orchestrator.runner = runner;
  merges.hooks = orchestrator;

  recoverAfterRestart(core);

  return {
    config,
    core,
    roles,
    messages,
    approvals,
    projects,
    agents,
    tasks,
    teams,
    merges,
    search,
    runner,
    orchestrator,
    runtimes: { claude, scripted },
    /** Graceful shutdown: stop scheduling, unwind agents, drain merges, then close the DB. */
    async close() {
      orchestrator.stop();
      await runner.stopAll();
      await merges.drain();
      pm.close();
      logs.flush();
      db.close();
    },
  };
}

export type Services = ReturnType<typeof createServices>;

/** Work that was in flight when the server died is re-queued; nothing pretends to be running. */
function recoverAfterRestart(core: Core) {
  core.db.run("UPDATE tasks SET status = 'queued' WHERE status IN ('working','testing','assigned')");
  core.db.run("UPDATE agents SET status = 'idle', status_reason = 'Recovered after server restart', current_task_id = NULL, cpu = 0, mem_mb = 0 WHERE status IN ('working','communicating','waiting','queued')");
  core.db.run("UPDATE projects SET status = 'paused' WHERE status IN ('running','planning')");
}
