import type { RoleDefinition } from '../../shared/types.js';
import { BUILTIN_ROLES, BUILTIN_ROLE_IDS } from '../../shared/roles.js';
import type { Core } from '../core.js';
import { HttpError, slug } from '../util.js';

/** Built-in roles live in code; custom roles (and overrides) live in the DB. */
export class RoleService {
  constructor(private core: Core) {}

  list(): RoleDefinition[] {
    const custom = this.core.repos.roles.all('ORDER BY created_at').map(({ createdAt: _c, ...r }) => ({ ...r, builtin: false }));
    const overridden = new Set(custom.map((r) => r.id));
    return [...BUILTIN_ROLES.filter((r) => !overridden.has(r.id)), ...custom.map((r) => ({ ...r, builtin: BUILTIN_ROLE_IDS.has(r.id) }))];
  }

  get(id: string): RoleDefinition {
    const r = this.list().find((x) => x.id === id);
    if (!r) throw new HttpError(404, `Unknown role: ${id}`);
    return r;
  }

  find(id: string): RoleDefinition | undefined {
    return this.list().find((x) => x.id === id);
  }

  /** Create or override a role. */
  upsert(input: Omit<RoleDefinition, 'builtin' | 'id'> & { id?: string }): RoleDefinition {
    const id = input.id ? slug(input.id, 40) : `custom-${slug(input.name, 32)}`;
    const existing = this.core.repos.roles.get(id);
    const row = { ...input, id, createdAt: existing?.createdAt ?? Date.now() };
    if (existing) this.core.repos.roles.update(id, row);
    else this.core.repos.roles.insert(row);
    return this.get(id);
  }

  delete(id: string): void {
    if (BUILTIN_ROLE_IDS.has(id) && !this.core.repos.roles.get(id)) throw new HttpError(400, 'Built-in roles cannot be deleted.');
    this.core.repos.roles.delete(id);
  }

  /** Best role for a free-form hint ("backend", "physics engineer", ...). */
  match(hint: string | null | undefined): RoleDefinition {
    const roles = this.list();
    if (!hint) return roles.find((r) => r.id === 'backend')!;
    const h = hint.toLowerCase();
    return (
      roles.find((r) => r.id === h) ??
      roles.find((r) => r.name.toLowerCase() === h) ??
      roles.find((r) => r.taskTypes.includes(h)) ??
      roles.find((r) => h.includes(r.id) || r.name.toLowerCase().includes(h)) ??
      roles.find((r) => r.id === 'backend')!
    );
  }
}
