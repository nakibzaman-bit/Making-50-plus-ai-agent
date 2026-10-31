import { Network, GitBranch, ListTodo, GitMerge, MessagesSquare, Gauge, Users, Settings, FolderTree } from 'lucide-react';
import clsx from 'clsx';
import { useStore, type View } from '../../store/store';

const ITEMS: { id: View; label: string; icon: React.ComponentType<{ size?: number }> }[] = [
  { id: 'canvas', label: 'Canvas', icon: Network },
  { id: 'tree', label: 'Agent tree', icon: FolderTree },
  { id: 'tasks', label: 'Tasks', icon: ListTodo },
  { id: 'branches', label: 'Branches', icon: GitBranch },
  { id: 'merge', label: 'Merge queue', icon: GitMerge },
  { id: 'comms', label: 'Communications', icon: MessagesSquare },
  { id: 'resources', label: 'Resources', icon: Gauge },
  { id: 'roles', label: 'Roles', icon: Users },
  { id: 'settings', label: 'Settings', icon: Settings },
];

export function NavRail() {
  const view = useStore((s) => s.view);
  const pendingMerges = useStore((s) => Object.values(s.merges).filter((m) => m.status === 'awaiting_approval').length + Object.values(s.approvals).filter((a) => a.status === 'pending' && a.kind === 'command').length);
  const failed = useStore((s) => Object.values(s.tasks).filter((t) => t.status === 'failed').length);
  return (
    <nav aria-label="Views" className="z-10 flex w-14 shrink-0 flex-col items-center gap-1 border-r hairline bg-ink-900/50 py-3 backdrop-blur-xl">
      {ITEMS.map(({ id, label, icon: Icon }) => {
        const badge = id === 'merge' ? pendingMerges : id === 'tasks' ? failed : 0;
        return (
          <button
            key={id}
            onClick={() => useStore.setState({ view: id })}
            aria-label={label}
            aria-current={view === id}
            title={label}
            className={clsx('group relative grid h-10 w-10 place-items-center rounded-xl transition', view === id ? 'bg-gradient-to-b from-blue-500/25 to-violet-500/15 text-white shadow-[inset_0_0_0_1px_rgba(147,197,253,0.25)]' : 'text-ink-400 hover:bg-white/[0.05] hover:text-ink-100')}
          >
            <Icon size={18} />
            {badge > 0 && <span className={clsx('absolute right-1 top-1 grid h-4 min-w-4 place-items-center rounded-full px-1 text-[9px] font-bold text-white', id === 'merge' ? 'bg-amber-500' : 'bg-red-500')}>{badge}</span>}
            <span className="pointer-events-none absolute left-12 whitespace-nowrap rounded-md bg-ink-700 px-2 py-1 text-[11px] text-ink-100 opacity-0 shadow-lg transition group-hover:opacity-100">{label}</span>
          </button>
        );
      })}
    </nav>
  );
}
