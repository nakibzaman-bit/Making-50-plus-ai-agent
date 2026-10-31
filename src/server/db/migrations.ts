export const MIGRATIONS: { version: number; sql: string }[] = [
  {
    version: 1,
    sql: `
CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  objective TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'idle',
  repo_path TEXT NOT NULL,
  settings TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE teams (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT NOT NULL,
  lead_agent_id TEXT,
  parent_team_id TEXT,
  collapsed INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_teams_project ON teams(project_id);

CREATE TABLE roles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  icon TEXT NOT NULL,
  color TEXT NOT NULL,
  description TEXT NOT NULL,
  system_prompt TEXT NOT NULL,
  capabilities TEXT NOT NULL,
  tools TEXT NOT NULL,
  permissions TEXT NOT NULL,
  preferred_model TEXT NOT NULL,
  task_types TEXT NOT NULL,
  priority INTEGER NOT NULL,
  limits TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE agents (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  team_id TEXT,
  parent_id TEXT,
  role_id TEXT NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL,
  status_reason TEXT,
  runtime TEXT NOT NULL,
  model TEXT NOT NULL,
  branch TEXT,
  workspace_path TEXT,
  priority INTEGER NOT NULL DEFAULT 5,
  current_task_id TEXT,
  pos_x REAL,
  pos_y REAL,
  tokens_in INTEGER NOT NULL DEFAULT 0,
  tokens_out INTEGER NOT NULL DEFAULT 0,
  token_budget INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL NOT NULL DEFAULT 0,
  cpu REAL NOT NULL DEFAULT 0,
  mem_mb REAL NOT NULL DEFAULT 0,
  runtime_ms INTEGER NOT NULL DEFAULT 0,
  started_at INTEGER,
  files_changed INTEGER NOT NULL DEFAULT 0,
  tests_passed INTEGER NOT NULL DEFAULT 0,
  tests_failed INTEGER NOT NULL DEFAULT 0,
  commits INTEGER NOT NULL DEFAULT 0,
  retries INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_agents_project ON agents(project_id);

CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'work',
  fixes_task_id TEXT,
  priority INTEGER NOT NULL DEFAULT 5,
  status TEXT NOT NULL,
  assigned_agent_id TEXT,
  role_hint TEXT,
  branch TEXT,
  script TEXT,
  recovery TEXT,
  requires_approval INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 2,
  files TEXT NOT NULL DEFAULT '[]',
  tests TEXT,
  result TEXT,
  error TEXT,
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  completed_at INTEGER,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_tasks_project ON tasks(project_id, status);

CREATE TABLE task_dependencies (
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  depends_on_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, depends_on_id)
);

CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  from_agent_id TEXT,
  to_agent_id TEXT,
  team_id TEXT,
  task_id TEXT,
  body TEXT NOT NULL,
  meta TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_messages_project ON messages(project_id, created_at);

CREATE TABLE logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  agent_id TEXT,
  task_id TEXT,
  stream TEXT NOT NULL,
  line TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_logs_agent ON logs(agent_id, id);
CREATE INDEX idx_logs_project ON logs(project_id, id);

CREATE TABLE links (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  source_agent_id TEXT NOT NULL,
  target_agent_id TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'manual',
  created_at INTEGER NOT NULL
);

CREATE TABLE merge_requests (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  agent_id TEXT,
  task_id TEXT,
  branch TEXT NOT NULL,
  status TEXT NOT NULL,
  checks TEXT NOT NULL,
  conflict_files TEXT NOT NULL DEFAULT '[]',
  merged_commit TEXT,
  error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_merges_project ON merge_requests(project_id);

CREATE TABLE approvals (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  agent_id TEXT,
  kind TEXT NOT NULL,
  payload TEXT NOT NULL,
  status TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  resolved_at INTEGER
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`,
  },
];
