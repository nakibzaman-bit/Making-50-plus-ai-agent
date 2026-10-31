import type { Agent, Team } from '../../shared/types';

export const NODE_W = 272;
export const NODE_H = 196;
const HGAP = 36;
const VGAP = 84;
const GRID_THRESHOLD = 5;

interface TreeNode {
  id: string;
  children: TreeNode[];
  w: number;
  h: number;
  grid: boolean;
  cols: number;
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
      return { id: a.id, children, grid: true, cols, w: Math.max(NODE_W, cols * NODE_W + (cols - 1) * HGAP), h: NODE_H + VGAP + rows * NODE_H + (rows - 1) * (HGAP + 8) };
    }
    const cw = children.reduce((s, c) => s + c.w, 0) + Math.max(0, children.length - 1) * HGAP;
    const ch = children.length ? Math.max(...children.map((c) => c.h)) + VGAP : 0;
    return { id: a.id, children, grid: false, cols: 0, w: Math.max(NODE_W, cw), h: NODE_H + ch };
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
    const cw = n.children.reduce((s, c) => s + c.w, 0) + Math.max(0, n.children.length - 1) * HGAP;
    let x = left + (n.w - cw) / 2;
    for (const c of n.children) {
      place(c, x, childTop);
      x += c.w + HGAP;
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
