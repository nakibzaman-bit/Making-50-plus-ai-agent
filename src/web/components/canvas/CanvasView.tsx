import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
  type NodeChange,
  type OnSelectionChangeParams,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Pause, Play, Square, Trash2, X } from 'lucide-react';
import { useStore } from '../../store/store';
import { act, backend } from '../../store/controller';
import { AgentNode, TeamZone } from './AgentNode';
import { FlowEdge } from './FlowEdge';
import { hiddenAgentIds, layoutAgents, NODE_H, NODE_W } from '../../lib/layout';
import { agentTone, TONE_HEX } from '../../lib/status';
import { CanvasToolbar } from './CanvasToolbar';
import { ObjectiveBar } from './ObjectiveBar';
import { Button, Empty } from '../ui';

const nodeTypes = { agent: AgentNode, team: TeamZone };
const edgeTypes = { flow: FlowEdge };

function Inner() {
  const agentsMap = useStore((s) => s.agents);
  const teams = useStore((s) => s.teams);
  const links = useStore((s) => s.links);
  const comms = useStore((s) => s.comms);
  const projectId = useStore((s) => s.projectId);
  const query = useStore((s) => s.canvasQuery);
  const focusRequest = useStore((s) => s.focusRequest);
  const layoutRequest = useStore((s) => s.layoutRequest);
  const selectedAgentId = useStore((s) => s.selectedAgentId);
  const rf = useReactFlow();
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [multi, setMulti] = useState<string[]>([]);
  const [, force] = useState(0);
  const fitted = useRef<string | null>(null);

  // Structural key: re-derive nodes only when membership/topology changes, not on every status tick.
  const agents = useMemo(() => Object.values(agentsMap), [agentsMap]);
  const structureKey = useMemo(
    () => agents.map((a) => `${a.id}:${a.parentId}:${a.teamId}:${a.posX ?? ''}:${a.posY ?? ''}`).join('|') + '#' + Object.values(teams).map((t) => `${t.id}:${t.collapsed}:${t.leadAgentId}`).join('|'),
    [agents, teams],
  );

  useEffect(() => {
    const hidden = hiddenAgentIds(agents, teams);
    const auto = layoutAgents(agents, teams);
    const ql = query.trim().toLowerCase();
    setNodes((prev) => {
      const prevPos = new Map(prev.map((n) => [n.id, n.position]));
      const prevSel = new Set(prev.filter((n) => n.selected).map((n) => n.id));
      const hiddenByLead = new Map<string, number>();
      for (const id of hidden) {
        const t = teams[agentsMap[id]?.teamId ?? ''];
        if (t?.leadAgentId) hiddenByLead.set(t.leadAgentId, (hiddenByLead.get(t.leadAgentId) ?? 0) + 1);
      }
      return agents
        .filter((a) => !hidden.has(a.id))
        .map((a) => ({
          id: a.id,
          type: 'agent',
          position: a.posX != null && a.posY != null ? { x: a.posX, y: a.posY } : prevPos.get(a.id) ?? auto.get(a.id) ?? { x: 0, y: 0 },
          data: { agentId: a.id, dim: ql ? !`${a.name} ${a.roleId} ${a.branch ?? ''}`.toLowerCase().includes(ql) : false, hiddenCount: hiddenByLead.get(a.id) },
          selected: prevSel.has(a.id) || a.id === selectedAgentId,
          width: NODE_W,
          height: NODE_H,
        }));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [structureKey, query]);

  // Fit once per project load.
  useEffect(() => {
    if (nodes.length && fitted.current !== projectId) {
      fitted.current = projectId;
      requestAnimationFrame(() => rf.fitView({ padding: 0.12, duration: 600 }));
    }
  }, [nodes.length, projectId, rf]);

  // Expire transient comms edges.
  useEffect(() => {
    const t = setInterval(() => force((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!focusRequest) return;
    const n = rf.getNode(focusRequest.agentId);
    if (n) rf.setCenter(n.position.x + NODE_W / 2, n.position.y + NODE_H / 2, { zoom: 1.05, duration: 700 });
  }, [focusRequest, rf]);

  useEffect(() => {
    if (!layoutRequest || !projectId) return;
    const auto = layoutAgents(agents, teams);
    setNodes((prev) => prev.map((n) => ({ ...n, position: auto.get(n.id) ?? n.position })));
    const positions = [...auto].map(([id, p]) => ({ id, x: p.x, y: p.y }));
    for (const p of positions) useStore.setState((s) => ({ agents: { ...s.agents, [p.id]: s.agents[p.id] ? { ...s.agents[p.id], posX: p.x, posY: p.y } : s.agents[p.id] } }));
    void backend().savePositions(projectId, positions);
    setTimeout(() => rf.fitView({ padding: 0.12, duration: 700 }), 50);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutRequest]);

  const edges: Edge[] = useMemo(() => {
    const visible = new Set(nodes.map((n) => n.id));
    const out: Edge[] = [];
    for (const a of agents) {
      if (a.parentId && visible.has(a.id) && visible.has(a.parentId)) out.push({ id: `h-${a.id}`, source: a.parentId, target: a.id, type: 'flow', data: { kind: 'hierarchy', target: a.id }, selectable: false });
    }
    for (const l of Object.values(links)) if (visible.has(l.sourceAgentId) && visible.has(l.targetAgentId)) out.push({ id: `l-${l.id}`, source: l.sourceAgentId, target: l.targetAgentId, type: 'flow', data: { kind: 'manual', target: l.targetAgentId } });
    const seen = new Set<string>();
    for (const c of comms) {
      if (Date.now() - c.at > 4000 || !visible.has(c.from) || !visible.has(c.to)) continue;
      const parentEdge = agentsMap[c.to]?.parentId === c.from || agentsMap[c.from]?.parentId === c.to;
      const key = [c.from, c.to].sort().join('-');
      if (parentEdge || seen.has(key)) continue;
      seen.add(key);
      out.push({ id: `c-${key}-${c.at}`, source: c.from, target: c.to, type: 'flow', data: { kind: 'comms', target: c.to }, selectable: false, zIndex: 5 });
    }
    return out;
  }, [agents, agentsMap, links, comms, nodes]);

  // Team zones from current node positions.
  const zones: Node[] = useMemo(() => {
    const byTeam = new Map<string, { x0: number; y0: number; x1: number; y1: number; n: number }>();
    for (const n of nodes) {
      const tid = agentsMap[n.id]?.teamId;
      if (!tid) continue;
      const b = byTeam.get(tid) ?? { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity, n: 0 };
      b.x0 = Math.min(b.x0, n.position.x);
      b.y0 = Math.min(b.y0, n.position.y);
      b.x1 = Math.max(b.x1, n.position.x + NODE_W);
      b.y1 = Math.max(b.y1, n.position.y + NODE_H);
      b.n++;
      byTeam.set(tid, b);
    }
    const pad = 22;
    return [...byTeam].map(([tid, b]) => ({
      id: `zone-${tid}`,
      type: 'team',
      position: { x: b.x0 - pad, y: b.y0 - pad - 8 },
      data: { teamId: tid, width: b.x1 - b.x0 + pad * 2, height: b.y1 - b.y0 + pad * 2 + 8, count: agents.filter((a) => a.teamId === tid).length },
      draggable: false,
      selectable: false,
      focusable: false,
      zIndex: -1,
    }));
  }, [nodes, agentsMap, agents]);

  const allNodes = useMemo(() => [...zones, ...nodes], [zones, nodes]);

  const handleNodesChange = useCallback((changes: NodeChange[]) => onNodesChange(changes.filter((c) => !('id' in c) || !String(c.id).startsWith('zone-'))), [onNodesChange]);

  const onNodeDragStop = useCallback(
    (_: unknown, _node: Node, dragged: Node[]) => {
      if (!projectId) return;
      const positions = dragged.filter((n) => n.type === 'agent').map((n) => ({ id: n.id, x: Math.round(n.position.x), y: Math.round(n.position.y) }));
      useStore.setState((s) => {
        const agents = { ...s.agents };
        for (const p of positions) if (agents[p.id]) agents[p.id] = { ...agents[p.id], posX: p.x, posY: p.y };
        return { agents };
      });
      void backend().savePositions(projectId, positions);
    },
    [projectId],
  );

  const onConnect = useCallback(
    (c: Connection) => {
      if (projectId && c.source && c.target && c.source !== c.target) void act((b) => b.link(projectId, c.source!, c.target!), 'Connection created');
    },
    [projectId],
  );

  const onEdgesDelete = useCallback((deleted: Edge[]) => {
    for (const e of deleted) if (e.id.startsWith('l-')) void act((b) => b.unlink(e.id.slice(2)));
  }, []);

  const onSelectionChange = useCallback(({ nodes: sel }: OnSelectionChangeParams) => {
    const ids = sel.filter((n) => n.type === 'agent').map((n) => n.id);
    setMulti(ids.length > 1 ? ids : []);
  }, []);

  const bulk = (action: 'pause' | 'resume' | 'stop') => {
    for (const id of multi) void act((b) => b.agentAction(id, action));
  };

  if (!agents.length) {
    return <Empty title="No agents yet" body="Give the orchestrator an objective, spawn an agent, or load the NEXUS TEST LAB." action={<Button variant="primary" onClick={() => useStore.setState({ dialog: { kind: 'spawn' } })}>Spawn agent</Button>} />;
  }

  return (
    <div className="relative h-full w-full">
      <ReactFlow
        nodes={allNodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={handleNodesChange}
        onNodeDragStop={onNodeDragStop}
        onNodeClick={(_, n) => n.type === 'agent' && useStore.getState().select(n.id)}
        onNodeDoubleClick={(_, n) => n.type === 'agent' && useStore.getState().focusAgent(n.id)}
        onPaneClick={() => useStore.getState().select(null)}
        onConnect={onConnect}
        onEdgesDelete={onEdgesDelete}
        onSelectionChange={onSelectionChange}
        onMove={(_, vp) => {
          const compact = vp.zoom < 0.62;
          if (compact !== useStore.getState().compact) useStore.setState({ compact });
        }}
        minZoom={0.08}
        maxZoom={2}
        selectionOnDrag={false}
        panOnScroll={false}
        multiSelectionKeyCode={['Meta', 'Control', 'Shift']}
        deleteKeyCode={['Backspace', 'Delete']}
        onlyRenderVisibleElements
        proOptions={{ hideAttribution: true }}
        defaultEdgeOptions={{ type: 'flow' }}
      >
        <Background variant={BackgroundVariant.Dots} gap={28} size={1.2} color="rgba(140,160,220,0.14)" />
        <MiniMap pannable zoomable nodeStrokeWidth={0} nodeBorderRadius={6} maskColor="rgba(5,7,13,0.72)" nodeColor={(n) => (n.type === 'team' ? 'transparent' : TONE_HEX[agentTone(useStore.getState().agents[n.id]?.status ?? 'idle')])} position="bottom-right" />
        <Controls position="bottom-left" showInteractive={false} />
      </ReactFlow>
      <ObjectiveBar />
      <CanvasToolbar />
      {multi.length > 1 && (
        <div className="glass-strong absolute bottom-6 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2 rounded-2xl px-3 py-2" style={{ animation: 'fade-up .25s ease-out' }}>
          <span className="text-xs text-ink-200">{multi.length} agents selected</span>
          <Button size="xs" icon={<Pause size={11} />} onClick={() => bulk('pause')}>Pause</Button>
          <Button size="xs" icon={<Play size={11} />} onClick={() => bulk('resume')}>Resume</Button>
          <Button size="xs" variant="danger" icon={<Square size={10} />} onClick={() => bulk('stop')}>Stop</Button>
          <Button size="xs" variant="danger" icon={<Trash2 size={11} />} onClick={() => confirm(`Delete ${multi.length} agents and their worktrees?`) && multi.forEach((id) => void act((b) => b.deleteAgent(id)))}>Delete</Button>
          <button className="text-ink-400 hover:text-white" onClick={() => rf.setNodes((ns) => ns.map((n) => ({ ...n, selected: false })))}><X size={14} /></button>
        </div>
      )}
    </div>
  );
}

export default function CanvasView() {
  return (
    <ReactFlowProvider>
      <Inner />
    </ReactFlowProvider>
  );
}
