# NEXUS AI Workspace

**A visual command center for launching, watching and coordinating many AI coding agents at once.**

One orchestrator, team leads, specialists and sub-agents. Each agent works on its own git
branch in its own worktree. They are coordinated through a task dependency graph, talk to each
other on a message bus, and land their work through a gated merge queue. You watch all of it
live on an animated 2D canvas or in a 3D command view.

Nothing in LIVE mode is staged for show. Logs come from real processes, branches are real git
branches, test counts are parsed from real test runs, and CPU and memory are sampled from `/proc`.
The only simulation is **DEMO mode**. It runs entirely in the browser and is labelled on screen.

---

## Quick start

```bash
npm install
npm run dev            # API + WebSocket on :4317, UI on http://localhost:5173
```

Open http://localhost:5173 and press **RUN** on the built-in **NEXUS TEST LAB**.

To use LLM agents, put your key in `.env` (copy `.env.example`):

```bash
ANTHROPIC_API_KEY=sk-ant-...
```

Then type an objective into the bar at the top of the canvas, e.g. *"Build a complete football game"*.
The key stays on the server. It is never sent to the browser and never passed to agent processes.

Production:

```bash
npm run build && npm start     # serves the built UI and API on :4317
```

## What you can do

| Area | What's there |
|---|---|
| **Command center** | Active/total agents, running/completed/failed/blocked/review tasks, tokens, cost, CPU, memory, build, tests, branches, commits, uptime: all live |
| **Canvas (2D)** | Zoom, pan, drag, multi-select, bulk pause/stop/delete, draw connections between agents, delete them, search and focus, auto-arrange, collapse/expand teams, minimap. Edge colours: blue active · green completed · yellow waiting · red failed · purple communicating · grey idle, with particles flowing along live links |
| **3D command mode** | Teams on orbital sectors, status-coloured nodes, glowing connections, orbit camera, auto-focus on active agents, click to inspect |
| **Agent inspector** | Overview (incl. failure card: RETRY / REASSIGN / VIEW LOGS / SPAWN DEBUGGER / STOP), live terminal, files + diff / current / previous with REVERT / APPROVE / REQUEST CHANGES / MERGE, git history, tasks, messages, metric sparklines, system prompt / tools / permissions |
| **Tasks** | Kanban across all 11 statuses, dependencies (cycle-checked), retry / cancel / reassign |
| **Branch explorer** | MAIN → team → agent branch, ahead/behind, merge state, commit timeline |
| **Merge queue** | tests → conflicts → lint → build → integration (main+branch) → approval → merge, step-by-step and live |
| **Communications** | Direct, team, broadcast, task, system and user messages; message any agent or team |
| **Resources** | Host and agent CPU/RAM, slots, queue, tokens and cost by model; set MAX AGENTS / CONCURRENT TASKS / CPU / MEMORY |
| **Roles** | 27 built-in roles (orchestrator, PM, architect, frontend … marketing) plus custom roles |
| **Ctrl + K** | Command palette and global search over agents, tasks, branches, files, commits, messages, errors and projects |

## How "real" works without an LLM key

There are two agent runtimes:

- **Claude** (`claude`): an LLM agent driven by the Anthropic Messages API, using a tool loop NEXUS
  controls. The tools are `list_files`, `read_file`, `write_file`, `edit_file`, `run_command`,
  `git_status`, `git_commit`, `send_message`, `spawn_agent`, `create_task` and `complete_task`, each
  limited by the role's permissions. Agents read teammates' messages between turns, and tokens and
  cost are tracked per turn. Requires `ANTHROPIC_API_KEY`. Without a key, these agents wait in the
  queue with the reason shown. They never pretend to work.
- **Scripted** (`scripted`): LLM-free agents that execute an explicit list of steps (write file,
  run command, commit, message) for real. The NEXUS TEST LAB uses them.

The **NEXUS TEST LAB** has 22 agents in 5 teams with 21 dependent tasks. They build a small JavaScript
toolkit in parallel worktrees. Along the way you see:

- real `node --test` runs, commits and merges;
- a downstream module that imports two other agents' merged work;
- a **real bug**: its tests fail, it is retried, fails again, a **debugger agent is auto-spawned on
  the broken branch**, fixes it, and the blocked dependants resume;
- a security-sensitive merge that **waits for your approval** in the merge queue;
- messages between agents that carry real commit hashes.

Short `sleep` steps pace the run so a human can follow it; they produce no output.

## Architecture

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full design: requirements, folder plan,
database schema, agent architecture, API and UI.

```
React + Vite + Tailwind ── REST + WebSocket ──► Fastify (Node 22, TypeScript)
  React Flow (2D)                                 ├─ Orchestrator (planner → scheduler → recovery)
  React Three Fiber (3D, lazy)                    ├─ AgentRunner ─► runtimes (claude | scripted)
  Zustand store (LIVE or DEMO source)             ├─ ProcessManager ─► executor (local | docker)
                                                  ├─ GitService (worktrees, merge-tree, merges)
                                                  ├─ MergeQueue · TaskService · MessageService
                                                  └─ SQLite (node:sqlite, WAL) + event bus
```

- **Database:** built-in `node:sqlite`. No native build step; data lives in `.nexus/nexus.db`.
- **Isolation:** every agent gets `git worktree add -b agent/<name>-<id>`. Before each task it
  merges the latest `main` ("pulling changes").
- **Scheduling:** dependencies → ready queue → priority → MAX CONCURRENT / CPU / MEMORY limits →
  dynamic spawning of a new agent when a task's role has no free agent.
- **Recovery:** retry up to `maxTaskAttempts` → auto-spawned debugger → conflict-resolution tasks
  for LLM agents → human approval gates.
- **Restarts:** in-flight work is re-queued and projects come back paused.

## Security model

Agents execute code, so:

- **No shell, ever.** Commands are tokenised; pipes, redirects, `&&`, `$()` and backticks are rejected.
- **Allowlist of binaries** (node, npm, git, python, tsc, …). Shells, `sudo`, `docker`, `ssh`,
  `kill`, `env`, `sed`/`awk` and similar are denied.
- **Workspace confinement:** path arguments and file tools must resolve inside the agent's worktree.
  `..`, absolute paths, `~`, symlink escapes and `.git` are refused.
- **Git restrictions:** no push/fetch/merge/rebase/branch switching. Merging only happens through the merge queue.
- **Network** (`npm install`, `curl`, `pip`, …) only for roles with `exec.network`.
- **Destructive commands** (`rm -r`, `git reset --hard`, `git clean`) pause the agent until a human approves.
- **Scrubbed environment:** agents get a minimal env with their own `HOME`; anything named like a
  key, token or secret is never inherited, and secret values are redacted from output.
- **Limits:** per-command timeouts with process-group kill, an RSS watchdog, iteration caps and token budgets.
- **API:** binds to `127.0.0.1`, rejects cross-origin writes and WebSockets, and accepts an optional
  `NEXUS_AUTH_TOKEN` bearer token.

> The local executor gives **policy-level** isolation. Code an agent writes (for example a test file or
> an npm script) runs with your user's privileges. For **kernel-level** isolation (filesystem,
> network namespace, cgroups), set `NEXUS_EXECUTOR=docker` with a running Docker daemon. Each command
> then runs in a throwaway container with `--network none` (unless the role allows network),
> `--cap-drop ALL`, a memory and CPU cap, and only the worktree mounted.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | – | Enables the Claude runtime and the Claude planner |
| `NEXUS_DEFAULT_MODEL` | `claude-opus-5-5` | Default agent model (per role/agent overridable) |
| `NEXUS_PORT` / `NEXUS_HOST` | `4317` / `127.0.0.1` | Server address |
| `NEXUS_DATA_DIR` | `./.nexus` | DB, repositories, worktrees, agent homes |
| `NEXUS_EXECUTOR` | `local` | `local` or `docker` |
| `NEXUS_DOCKER_IMAGE` | `node:22-bookworm` | Image for the docker executor |
| `NEXUS_AUTH_TOKEN` | – | Require a bearer token for the API/WebSocket |
| `NEXUS_SEED_TEST_LAB` | `1` | Create the Test Lab on first start |

## Testing

```bash
npm run check          # typecheck (server + web) + lint + unit/integration tests
npm run build:web && npm run test:e2e   # real server + real Chromium, full Test Lab run
```

The unit and integration tests (Vitest) cover the command policy, path guard, env scrubbing,
real process execution (timeouts, kill, memory limit, `/proc` metrics), git worktrees and isolation,
conflicts, merges, the task DAG and cycles, agent spawn/delete and limits, messaging, approvals,
concurrency limits, dynamic spawning, pause/stop, the merge queue (conflicts, approval rejection),
the Claude tool loop (with an injected client, so no network), budgets, refusals, planners, the
REST API and WebSockets, and a full Test Lab run.

The e2e test drives the browser through intro → RUN → live terminal → auto-debugger → approving
the gated merge → completion → branches → tasks → Ctrl+K search → 3D → DEMO.

## Project layout

```
src/shared/     types, roles, pricing, event contracts
src/server/     api/ agents/ approvals/ db/ events/ git/ merge/ messages/ orchestrator/
                process/ projects/ roles/ search/ security/ tasks/ teams/
src/web/        api/ store/ demo/ lib/ components/{canvas,three,inspector,shell,command,dialogs,ui} views/
tests/          vitest suites (real git, real processes, real sqlite)
e2e/            Playwright end-to-end run
docs/           architecture
```
