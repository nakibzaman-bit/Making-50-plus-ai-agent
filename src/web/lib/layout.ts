import type { Agent, Team } from '../../shared/types';

export const NODE_W = 272;
export const NODE_H = 196;
const HGAP = 36;
const VGAP = 84;
const GRID_THRESHOLD = 5;
/** Wider child rows wrap onto additional rows so large workforces stay roughly screen-shaped. */
const MAX_ROW_W = 3200;

interface TreeNode {
  id: string;
  children: TreeNode[];
  w: number;
  h: number;
  grid: boolean;
  cols: number;
  rows: { items: TreeNode[]; w: number; h: number }[];
}

/** Agents hidden because their team is collapsed (the lead stays visible). */
export function hiddenAgentIds(agents: Agent[], teams: Record<string, Team>): Set<string> {
  const hidden = new Set<string>();
  for (const a of agents) {
    const t = a.teamId ? teams[a.teamId] : undefined;
    if (t?.collapsed && t.leadAgentId !== a.id) hidden.add(a.id);
  }
  return hidden;
}

/**
 * Tidy-tree layout over the agent hierarchy (parentId). Wide groups of leaf children
 * wrap into a grid so a lead with 20 agents doesn't produce a 6000px-wide row.
 */
export function layoutAgents(agents: Agent[], teams: Record<string, Team>): Map<string, { x: number; y: number }> {
  const visible = agents.filter((a) => !hiddenAgentIds(agents, teams).has(a.id));
  const ids = new Set(visible.map((a) => a.id));
  const kids = new Map<string, Agent[]>();
  const roots: Agent[] = [];
  for (const a of visible) {
    if (a.parentId && ids.has(a.parentId)) kids.set(a.parentId, [...(kids.get(a.parentId) ?? []), a]);
    else roots.push(a);
  }
  const teamOrder = (a: Agent) => (a.teamId ? Object.keys(teams).indexOf(a.teamId) : 999);
  const sortFn = (a: Agent, b: Agent) => teamOrder(a) - teamOrder(b) || a.createdAt - b.createdAt;

  const build = (a: Agent, seen: Set<string>): TreeNode => {
    seen.add(a.id);
    const children = (kids.get(a.id) ?? []).filter((c) => !seen.has(c.id)).sort(sortFn).map((c) => build(c, seen));
    const allLeaves = children.length >= GRID_THRESHOLD && children.every((c) => c.children.length === 0);
    if (allLeaves) {
      const cols = Math.min(4, Math.ceil(Math.sqrt(children.length * 1.4)));
      const rows = Math.ceil(children.length / cols);
      return { id: a.id, children, grid: true, cols, rows: [], w: Math.max(NODE_W, cols * NODE_W + (cols - 1) * HGAP), h: NODE_H + VGAP + rows * NODE_H + (rows - 1) * (HGAP + 8) };
    }
    // Greedily pack child subtrees into rows no wider than MAX_ROW_W.
    const rows: TreeNode['rows'] = [];
    for (const c of children) {
      const row = rows[rows.length - 1];
      if (row && row.w + HGAP * 2 + c.w <= MAX_ROW_W) {
        row.items.push(c);
        row.w += HGAP * 2 + c.w;
        row.h = Math.max(row.h, c.h);
      } else rows.push({ items: [c], w: c.w, h: c.h });
    }
    const cw = rows.length ? Math.max(...rows.map((r) => r.w)) : 0;
    const ch = rows.reduce((sum, r) => sum + r.h + VGAP, 0) + Math.max(0, rows.length - 1) * VGAP * 0.5;
    return { id: a.id, children, grid: false, cols: 0, rows, w: Math.max(NODE_W, cw), h: NODE_H + ch };
  };

  const out = new Map<string, { x: number; y: number }>();
  const place = (n: TreeNode, left: number, top: number) => {
    out.set(n.id, { x: left + n.w / 2 - NODE_W / 2, y: top });
    const childTop = top + NODE_H + VGAP;
    if (n.grid) {
      const gridW = n.cols * NODE_W + (n.cols - 1) * HGAP;
      const gx = left + (n.w - gridW) / 2;
      n.children.forEach((c, i) => out.set(c.id, { x: gx + (i % n.cols) * (NODE_W + HGAP), y: childTop + Math.floor(i / n.cols) * (NODE_H + HGAP + 8) }));
      return;
    }
    let top2 = childTop;
    for (const row of n.rows) {
      let x = left + (n.w - row.w) / 2;
      for (const c of row.items) {
        place(c, x, top2);
        x += c.w + HGAP * 2;
      }
      top2 += row.h + VGAP * 1.5;
    }
  };

  const seen = new Set<string>();
  const trees = roots.sort((a, b) => Number(b.roleId === 'orchestrator') - Number(a.roleId === 'orchestrator') || sortFn(a, b)).map((r) => build(r, seen));
  // Anything unreachable (cycles) becomes its own root.
  for (const a of visible) if (!seen.has(a.id)) trees.push(build(a, seen));
  let x = 0;
  for (const t of trees) {
    place(t, x, 0);
    x += t.w + HGAP * 3;
  }
  return out;
}
