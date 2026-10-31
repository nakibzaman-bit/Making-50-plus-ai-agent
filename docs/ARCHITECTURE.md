# NEXUS AI Workspace — Architecture

> An operating system for AI software engineers: one orchestrator, team leads, specialised
> agents and sub-agents, each working in its own git worktree, coordinated through a task DAG,
> a message bus and a gated merge queue — all observable live.

## 1. Environment findings (inspected at start)

| Item | Finding | Decision |
|---|---|---|
| OS | Linux x86_64, 4 vCPU, 15 GB RAM | `/proc`-based process metrics, `ps` fallback |
| Node | v22.23 | Use built-in `node:sqlite` (no native compile, works offline) |
| Pkg manager | npm 10, pnpm, yarn present | npm (lockfile committed) |
| Git | 2.43 | Worktrees + `git merge-tree --write-tree` for conflict pre-checks |
| Docker | CLI present, **no daemon** | `LocalExecutor` (hardened child processes) by default; `DockerExecutor` behind `NEXUS_EXECUTOR=docker` |
| Browser | Chromium + Playwright 1.63 preinstalled | E2E via the `playwright` library |

## 2. Requirements → design pillars

1. **Real execution, never theatre.** Every log line in LIVE mode comes from a real child
   process; every branch is a real git branch with a real worktree; every metric is sampled
   from `/proc`. Simulation exists only in **DEMO mode**, which runs entirely in the browser,
   never touches the database, and is labelled on screen.
2. **Pluggable agent runtimes.**
   - `claude` — Claude via the Anthropic Messages API, using a manual tool-use loop (gated tools,
     pause/stop between turns, token and cost accounting). Requires `ANTHROPIC_API_KEY`.
   - `scripted` — deterministic, LLM-free agents that execute a declared step list (write file,
     run command, commit, message) for real. Powers NEXUS TEST LAB and CI tests. Marked
     "SCRIPTED" in the UI.
   - The `AgentRuntime` interface allows adding others (e.g. Claude Agent SDK, local models).
3. **Scale.** Agents, teams and tasks are rows, not components; nothing is capped at 10. The
   canvas uses React Flow (virtualised node rendering), lists are virtualised, logs stream in
   batches over one WebSocket.
4. **Security first.** Agents can never run a shell; commands are tokenised, checked against
   allow/deny policy and the agent's role permissions, executed with a scrubbed environment,
   confined to the agent's worktree, time-limited and memory-watched. Destructive commands
   become approval requests.

## 3. Folder plan

```
src/
  shared/            Types, enums, built-in role catalogue, event contracts (used by both sides)
  server/
    index.ts         Bootstrap: config → db → services → http + ws
    config.ts        Env-driven configuration (secrets stay server-side)
    context.ts       Service container (dependency injection by construction)
    db/              SQLite connection, migrations, typed repositories
    events/          In-process EventBus + WebSocket hub (batched fan-out)
    security/        Command policy, path guard, permission checks, env scrubbing
    process/         ProcessManager (spawn/kill/timeout/limits/log streaming), executors, metrics sampler
    git/             GitService: repo init, worktrees, commits, diffs, conflict check, merges
    agents/          AgentManager (lifecycle), runtimes/ (claude, scripted), tools (LLM tool surface)
    tasks/           TaskService (DAG, status machine), Scheduler (resource-aware dispatch)
    messages/        MessageService (direct / team / broadcast / task / system)
    merge/           MergeQueue (tests → conflicts → lint → build → integration → approval → merge)
    orchestrator/    Orchestrator (objective → plan → spawn → coordinate → recover), planners
    projects/        ProjectService, NEXUS TEST LAB seed
    api/             REST routes (Fastify)
  web/
    api/             REST client + WebSocket client (auto-reconnect)
    store/           Zustand store; LIVE and DEMO data sources feed the same store
    demo/            Browser-only demo simulator (clearly labelled)
    components/      canvas/, three/, panels/, inspector/, command/, ui/
    views/           Top-level views (Canvas, Tree, Tasks, Branches, Merge, Comms, Resources, Roles)
tests/               Vitest unit + integration tests (real git, real processes, real sqlite)
e2e/                 Playwright end-to-end run against a real server
docs/                This document
```

## 4. Database schema (SQLite, WAL)

```
projects(id, name, description, objective, status, repo_path, settings JSON, created_at, updated_at)
teams(id, project_id, name, color, lead_agent_id, parent_team_id, collapsed, created_at)
roles(id, name, icon, description, system_prompt, capabilities JSON, tools JSON, permissions JSON,
      preferred_model, task_types JSON, priority, limits JSON, builtin, created_at)   -- custom roles
agents(id, project_id, team_id, parent_id, role_id, name, status, runtime, model, branch,
       workspace_path, priority, current_task_id, pos_x, pos_y, status_reason,
       tokens_in, tokens_out, token_budget, cost_usd, cpu, mem_mb, runtime_ms, started_at,
       files_changed, tests_passed, tests_failed, commits, retries, created_at, updated_at)
tasks(id, project_id, title, description, priority, status, assigned_agent_id, role_hint,
      branch, script JSON, recovery JSON, requires_approval, attempts, max_attempts,
      files JSON, tests JSON, result, error, created_at, started_at, completed_at, updated_at)
task_dependencies(task_id, depends_on_id)                     -- DAG edges, cycle-checked
messages(id, project_id, kind, from_agent_id, to_agent_id, team_id, task_id, body, meta JSON, created_at)
logs(id, project_id, agent_id, task_id, stream, line, created_at)          -- real process output
links(id, project_id, source_agent_id, target_agent_id, kind, created_at) -- user-drawn connections
merge_requests(id, project_id, agent_id, task_id, branch, status, checks JSON, conflict_files JSON,
               merged_commit, error, created_at, updated_at)
approvals(id, project_id, agent_id, kind, payload JSON, status, reason, created_at, resolved_at)
settings(key, value JSON)                                     -- global settings
```

## 5. Agent architecture

```
             ┌───────────── Orchestrator ──────────────┐
objective →  │ Planner (LLM | heuristic) → Plan(teams,  │
             │ agents, tasks, deps) → AgentManager.spawn │
             └───────┬──────────────────────────────────┘
                     ▼
Scheduler tick ─► ready tasks (deps done, resources free) ─► AgentRunner
                     │                                          │
                     │      GitService.ensureWorktree(agent) ◄──┤ (sync with main first)
                     │      Runtime.run(task, ToolContext)  ◄───┤
                     │          ├ tools → SecurityPolicy → ProcessManager (real processes)
                     │          ├ tools → GitService (commit)   → events
                     │          └ tools → MessageService / spawn sub-agent / create task
                     ▼
           success → REVIEW → MergeQueue pipeline → COMPLETED (dependants unblock)
           failure → retry (attempts < max) → else FAILED → auto-spawn DEBUGGER agent
```

Agent lifecycle: `idle → queued → working ⇄ waiting/paused → completed | failed | stopped`.
Pause/stop are honoured between tool calls; stop kills the agent's process group.

**Roles** (26 built-in + custom) define: system instructions, capabilities, tool set,
permissions (`fs.write`, `exec`, `exec.network`, `git.commit`, `agents.spawn`, `tasks.create`,
`merge.request`), preferred model, task types, default priority, resource limits
(command timeout, memory, max tool iterations, token budget).

## 6. API architecture

REST (Fastify, JSON, zod-validated) under `/api`, real-time over one WebSocket at `/ws`.

| Area | Endpoints |
|---|---|
| System | `GET /health`, `GET /system` (runtimes, executor, key present — never the key) |
| Projects | `GET/POST /projects`, `GET/PATCH/DELETE /projects/:id`, `GET /projects/:id/snapshot`, `PATCH /projects/:id/settings` |
| Orchestrator | `POST /projects/:id/objective`, `POST /projects/:id/run`, `POST /projects/:id/halt` |
| Agents | `POST /projects/:id/agents`, `PATCH/DELETE /agents/:id`, `POST /agents/:id/{pause,resume,stop,retry,debug}`, `GET /agents/:id/{logs,git,files,file,diff}`, `POST /agents/:id/revert` |
| Teams | `POST /projects/:id/teams`, `PATCH/DELETE /teams/:id` |
| Tasks | `POST /projects/:id/tasks`, `PATCH /tasks/:id`, `POST /tasks/:id/{cancel,retry,reassign}`, `POST/DELETE /tasks/:id/deps` |
| Messages | `GET/POST /projects/:id/messages` |
| Links | `POST /projects/:id/links`, `DELETE /links/:id` |
| Git | `GET /projects/:id/branches`, `GET /projects/:id/commits` |
| Merge | `GET/POST /projects/:id/merges`, `POST /merges/:id/{approve,reject,retry}` |
| Approvals | `GET /projects/:id/approvals`, `POST /approvals/:id/{approve,deny}` |
| Roles | `GET/POST /roles`, `DELETE /roles/:id` |
| Search | `GET /projects/:id/search?q=` |

WebSocket events: `agent.*`, `team.*`, `task.*`, `message.created`, `log.batch`, `git.commit`,
`merge.updated`, `approval.*`, `metrics.tick`, `project.updated`, `orchestrator.log`.

## 7. UI architecture

- **Shell**: intro (≈1.5 s, skippable, once per session) → top Command Center bar (stats,
  LIVE/DEMO toggle, project switcher, ⌘K) → left nav rail → main view → right Inspector →
  bottom Comms dock.
- **Canvas (2D)**: React Flow with custom `AgentNode`, animated `FlowEdge` (colour by state,
  moving particles), team group collapse, auto-layout (tidy tree), search/focus, multi-select,
  drag-to-connect (persisted links).
- **3D Command Mode**: lazy-loaded React Three Fiber scene; teams arranged in orbital sectors,
  status-coloured nodes, glowing connections, auto-focus camera on active agents; clicking a node
  opens the same Inspector, so it is a usable view rather than decoration.
- **Inspector**: Overview, Terminal (virtualised live log), Files + Diff viewer
  (revert/approve/request changes/merge), Git, Tasks, Messages, Metrics (sparklines), Prompt.
- **State**: a single Zustand store normalised by id; WebSocket events apply incremental
  patches; selectors are memoised so 50+ nodes do not re-render on every log line.

## 8. Security model

See `src/server/security/`. Summary: no shell; tokenised argv; executable allowlist per
permission; deny rules (privilege escalation, network fetch-and-run, raw device access, fork bombs);
path arguments must resolve inside the workspace; destructive commands (`rm -r`, `git reset --hard`,
`git push`, `git clean`, …) create approval requests; scrubbed env (no `*_KEY`, `*_TOKEN`,
`*_SECRET`); per-command timeout with process-group kill; RSS watchdog; output caps; API keys
stay in the server process and are never serialised to the client.
