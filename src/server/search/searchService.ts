import type { SearchResult } from '../../shared/types.js';
import type { Core } from '../core.js';

/** Global search across agents, tasks, branches, files, commits, messages, errors and projects. */
export class SearchService {
  constructor(private core: Core) {}

  async search(projectId: string | null, q: string, limit = 40): Promise<SearchResult[]> {
    const query = q.trim();
    if (!query) return [];
    const like = `%${query}%`;
    const out: SearchResult[] = [];
    const lower = query.toLowerCase();

    for (const p of this.core.repos.projects.where('name LIKE ? OR description LIKE ? LIMIT 10', like, like))
      out.push({ type: 'project', id: p.id, title: p.name, subtitle: p.description || 'Project', projectId: p.id });
    if (!projectId) return out.slice(0, limit);

    const agents = this.core.repos.agents.where('project_id = ?', projectId);
    for (const a of agents.filter((a) => `${a.name} ${a.roleId} ${a.branch ?? ''}`.toLowerCase().includes(lower)).slice(0, 15))
      out.push({ type: 'agent', id: a.id, title: a.name, subtitle: `${a.roleId} · ${a.status}${a.branch ? ` · ${a.branch}` : ''}`, projectId, agentId: a.id });
    for (const a of agents.filter((a) => a.branch?.toLowerCase().includes(lower)).slice(0, 10))
      out.push({ type: 'branch', id: a.branch!, title: a.branch!, subtitle: `Branch of ${a.name}`, projectId, agentId: a.id });
    for (const t of this.core.repos.tasks.where('project_id = ? AND (title LIKE ? OR description LIKE ? OR id = ?) LIMIT 15', projectId, like, like, query))
      out.push({ type: 'task', id: t.id, title: t.title, subtitle: `${t.status} · priority ${t.priority}`, projectId, agentId: t.assignedAgentId ?? undefined });
    const files = new Map<string, string | undefined>();
    for (const t of this.core.repos.tasks.byProject(projectId)) for (const f of t.files) if (f.toLowerCase().includes(lower)) files.set(f, t.assignedAgentId ?? undefined);
    for (const [f, agentId] of [...files].slice(0, 10)) out.push({ type: 'file', id: f, title: f, subtitle: 'Changed file', projectId, agentId });
    for (const m of this.core.repos.messages.where('project_id = ? AND body LIKE ? ORDER BY created_at DESC LIMIT 10', projectId, like))
      out.push({ type: 'message', id: m.id, title: m.body.slice(0, 120), subtitle: `${m.kind} message`, projectId, agentId: m.fromAgentId ?? undefined });
    for (const t of this.core.repos.tasks.where("project_id = ? AND error LIKE ? LIMIT 10", projectId, like))
      out.push({ type: 'error', id: t.id, title: (t.error ?? '').slice(0, 120), subtitle: `Error in “${t.title}”`, projectId, agentId: t.assignedAgentId ?? undefined });
    for (const l of this.core.repos.logs.search(projectId, query, 10))
      out.push({ type: 'error', id: `log-${l.id}`, title: l.line.slice(0, 120), subtitle: 'stderr', projectId, agentId: l.agentId ?? undefined });
    const project = this.core.repos.projects.get(projectId);
    if (project) {
      const r = await this.core.git.exec(project.repoPath, ['log', '--all', '-n', '400', '--format=%H%x1f%h%x1f%an%x1f%s'], { allowFail: true });
      const commits = r.stdout.split('\n').filter((l) => l.toLowerCase().includes(lower)).slice(0, 10);
      for (const c of commits) {
        const [hash, short, author, msg] = c.split('\u001f');
        out.push({ type: 'commit', id: hash, title: `${short} ${msg}`, subtitle: author, projectId, agentId: agents.find((a) => a.name === author)?.id });
      }
    }
    return out.slice(0, limit);
  }
}
