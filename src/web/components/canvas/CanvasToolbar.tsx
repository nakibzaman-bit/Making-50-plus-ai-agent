import { Box, LayoutGrid, Maximize, Minimize2, Plus, Search, Square as SquareIcon, ListPlus, Layers } from 'lucide-react';
import { useReactFlow } from '@xyflow/react';
import { useStore } from '../../store/store';
import { act } from '../../store/controller';
import { IconButton } from '../ui';

export function CanvasToolbar() {
  const rf = useReactFlow();
  const query = useStore((s) => s.canvasQuery);
  const agents = useStore((s) => s.agents);
  const teams = useStore((s) => s.teams);
  const anyCollapsed = Object.values(teams).some((t) => t.collapsed);

  const onEnter = () => {
    const ql = query.trim().toLowerCase();
    const hit = Object.values(agents).find((a) => `${a.name} ${a.roleId} ${a.branch ?? ''}`.toLowerCase().includes(ql));
    if (hit) useStore.getState().focusAgent(hit.id);
  };

  return (
    <div className="absolute right-4 top-4 z-10 flex items-center gap-1.5">
      <div className="glass flex h-9 items-center gap-2 rounded-xl px-2.5">
        <Search size={13} className="text-ink-400" />
        <input
          value={query}
          onChange={(e) => useStore.setState({ canvasQuery: e.target.value })}
          onKeyDown={(e) => e.key === 'Enter' && onEnter()}
          placeholder="Find agent…"
          aria-label="Search agents on canvas"
          className="w-36 bg-transparent text-xs text-ink-100 outline-none placeholder:text-ink-400"
        />
      </div>
      <div className="glass flex h-9 items-center gap-0.5 rounded-xl px-1">
        <IconButton label="Spawn agent" onClick={() => useStore.setState({ dialog: { kind: 'spawn' } })}><Plus size={15} /></IconButton>
        <IconButton label="New task" onClick={() => useStore.setState({ dialog: { kind: 'task' } })}><ListPlus size={15} /></IconButton>
        <IconButton label="Create team" onClick={() => useStore.setState({ dialog: { kind: 'team' } })}><Layers size={14} /></IconButton>
        <span className="mx-0.5 h-4 w-px bg-white/10" />
        <IconButton label="Auto-arrange workspace" onClick={() => useStore.setState((s) => ({ layoutRequest: s.layoutRequest + 1 }))}><LayoutGrid size={14} /></IconButton>
        <IconButton label={anyCollapsed ? 'Expand all teams' : 'Collapse all teams'} onClick={() => Object.values(teams).forEach((t) => void act((b) => b.updateTeam(t.id, { collapsed: !anyCollapsed })))}>{anyCollapsed ? <Maximize size={14} /> : <Minimize2 size={14} />}</IconButton>
        <IconButton label="Fit view" onClick={() => rf.fitView({ padding: 0.12, duration: 600 })}><SquareIcon size={13} /></IconButton>
        <span className="mx-0.5 h-4 w-px bg-white/10" />
        <IconButton label="3D command mode" onClick={() => useStore.setState({ dims: '3d' })}><Box size={14} /></IconButton>
      </div>
    </div>
  );
}
