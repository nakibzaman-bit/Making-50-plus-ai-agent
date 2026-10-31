import fs from 'node:fs';
import path from 'node:path';
import type { Project, ProjectSettings } from '../../shared/types.js';
import { DEFAULT_PROJECT_SETTINGS } from '../../shared/defaults.js';
import type { Core } from '../core.js';
import { HttpError, id, now } from '../util.js';

export interface CreateProjectInput {
  name: string;
  description?: string;
  objective?: string;
  settings?: Partial<ProjectSettings>;
  /** Files committed in the initial commit of the project's repository. */
  files?: Record<string, string>;
}

export class ProjectService {
  constructor(private core: Core) {}

  workspaceDir(projectId: string) {
    return path.join(this.core.config.workspacesDir, projectId);
  }

  worktreeDir(projectId: string, agentId: string) {
    return path.join(this.workspaceDir(projectId), 'worktrees', agentId);
  }

  async create(input: CreateProjectInput): Promise<Project> {
    const pid = id('prj');
    const repoPath = path.join(this.workspaceDir(pid), 'repo');
    const settings: ProjectSettings = {
      ...DEFAULT_PROJECT_SETTINGS,
      defaultModel: this.core.config.defaultModel,
      defaultRuntime: this.core.config.anthropicApiKey ? 'claude' : DEFAULT_PROJECT_SETTINGS.defaultRuntime,
      ...input.settings,
    };
    await this.core.git.initRepo(repoPath, input.files ?? {});
    const project: Project = {
      id: pid,
      name: input.name.trim().slice(0, 80) || 'Untitled project',
      description: input.description ?? '',
      objective: input.objective ?? '',
      status: 'idle',
      repoPath,
      settings,
      createdAt: now(),
      updatedAt: now(),
    };
    this.core.repos.projects.insert(project);
    this.core.bus.emit({ type: 'project.updated', projectId: pid, project });
    return project;
  }

  list(): Project[] {
    return this.core.repos.projects.all('ORDER BY created_at');
  }

  get(projectId: string): Project {
    const p = this.core.repos.projects.get(projectId);
    if (!p) throw new HttpError(404, 'Project not found');
    return p;
  }

  update(projectId: string, patch: Partial<Pick<Project, 'name' | 'description' | 'objective' | 'status'>>): Project {
    this.get(projectId);
    this.core.repos.projects.update(projectId, { ...patch, updatedAt: now() });
    const p = this.get(projectId);
    this.core.bus.emit({ type: 'project.updated', projectId, project: p });
    return p;
  }

  updateSettings(projectId: string, patch: Partial<ProjectSettings>): Project {
    const p = this.get(projectId);
    const settings = { ...p.settings, ...patch };
    settings.maxAgents = Math.max(1, Math.min(1000, Math.floor(settings.maxAgents)));
    settings.maxConcurrentTasks = Math.max(1, Math.min(256, Math.floor(settings.maxConcurrentTasks)));
    this.core.repos.projects.update(projectId, { settings, updatedAt: now() });
    const updated = this.get(projectId);
    this.core.bus.emit({ type: 'project.updated', projectId, project: updated });
    return updated;
  }

  /** Caller must stop the project's agents first. */
  delete(projectId: string): void {
    this.get(projectId);
    this.core.repos.projects.delete(projectId);
    fs.rmSync(this.workspaceDir(projectId), { recursive: true, force: true });
    this.core.bus.emit({ type: 'project.deleted', projectId });
  }
}
