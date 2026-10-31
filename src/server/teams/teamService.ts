import type { Link, Team } from '../../shared/types.js';
import { TEAM_COLORS } from '../../shared/defaults.js';
import type { Core } from '../core.js';
import { HttpError, id, now } from '../util.js';

/** Teams and user-drawn agent links (the topology shown on the canvas). */
export class TeamService {
  constructor(private core: Core) {}

  list(projectId: string): Team[] {
    return this.core.repos.teams.where('project_id = ? ORDER BY created_at', projectId);
  }

  get(teamId: string): Team {
    const t = this.core.repos.teams.get(teamId);
    if (!t) throw new HttpError(404, 'Team not found');
    return t;
  }

  create(projectId: string, input: { name: string; color?: string; leadAgentId?: string | null; parentTeamId?: string | null }): Team {
    const count = this.list(projectId).length;
    const team: Team = {
      id: id('team'),
      projectId,
      name: input.name.trim().slice(0, 60) || `Team ${count + 1}`,
      color: input.color ?? TEAM_COLORS[count % TEAM_COLORS.length],
      leadAgentId: input.leadAgentId ?? null,
      parentTeamId: input.parentTeamId ?? null,
      collapsed: false,
      createdAt: now(),
    };
    this.core.repos.teams.insert(team);
    this.core.bus.emit({ type: 'team.upserted', projectId, team });
    return team;
  }

  update(teamId: string, patch: Partial<Pick<Team, 'name' | 'color' | 'leadAgentId' | 'collapsed' | 'parentTeamId'>>): Team {
    const t = this.get(teamId);
    this.core.repos.teams.update(teamId, patch);
    const team = { ...t, ...patch };
    this.core.bus.emit({ type: 'team.upserted', projectId: t.projectId, team });
    return team;
  }

  delete(teamId: string): void {
    const t = this.get(teamId);
    const moved = this.core.repos.agents.where('team_id = ?', teamId);
    this.core.db.tx(() => {
      this.core.db.run('UPDATE agents SET team_id = NULL WHERE team_id = ?', teamId);
      this.core.repos.teams.delete(teamId);
    });
    this.core.bus.emit({ type: 'team.removed', projectId: t.projectId, teamId });
    for (const a of moved) this.core.bus.emit({ type: 'agent.upserted', projectId: a.projectId, agent: { ...a, teamId: null } });
  }

  links(projectId: string): Link[] {
    return this.core.repos.links.where('project_id = ?', projectId);
  }

  link(projectId: string, sourceAgentId: string, targetAgentId: string): Link {
    if (sourceAgentId === targetAgentId) throw new HttpError(400, 'Cannot link an agent to itself');
    for (const a of [sourceAgentId, targetAgentId]) {
      const ag = this.core.repos.agents.get(a);
      if (!ag || ag.projectId !== projectId) throw new HttpError(400, 'Unknown agent');
    }
    const existing = this.core.repos.links.where('project_id = ? AND source_agent_id = ? AND target_agent_id = ?', projectId, sourceAgentId, targetAgentId)[0];
    if (existing) return existing;
    const link: Link = { id: id('lnk'), projectId, sourceAgentId, targetAgentId, kind: 'manual', createdAt: now() };
    this.core.repos.links.insert(link);
    this.core.bus.emit({ type: 'link.upserted', projectId, link });
    return link;
  }

  unlink(linkId: string): void {
    const l = this.core.repos.links.get(linkId);
    if (!l) throw new HttpError(404, 'Link not found');
    this.core.repos.links.delete(linkId);
    this.core.bus.emit({ type: 'link.removed', projectId: l.projectId, linkId });
  }
}
