import { X, CheckCircle2, AlertTriangle, XCircle, Info } from 'lucide-react';
import { useStore } from '../../store/store';

const ICON = { success: CheckCircle2, warn: AlertTriangle, error: XCircle, info: Info };
const COLOR = { success: '#22c55e', warn: '#eab308', error: '#ef4444', info: '#60a5fa' };

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  return (
    <div className="pointer-events-none fixed bottom-16 right-4 z-[60] flex w-80 flex-col gap-2" aria-live="polite">
      {toasts.map((t) => {
        const Icon = ICON[t.tone];
        return (
          <div key={t.id} className="glass-strong pointer-events-auto flex gap-2.5 rounded-xl p-3" style={{ animation: 'fade-up .25s ease-out', boxShadow: `inset 3px 0 0 ${COLOR[t.tone]}` }}>
            <Icon size={16} style={{ color: COLOR[t.tone] }} className="mt-0.5 shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-medium text-white">{t.title}</div>
              {t.body && <div className="mt-0.5 line-clamp-3 text-xs text-ink-300">{t.body}</div>}
              {t.action && <button className="mt-1.5 text-xs font-medium text-blue-300 hover:text-blue-200" onClick={() => { t.action!.run(); useStore.getState().dismissToast(t.id); }}>{t.action.label} →</button>}
            </div>
            <button aria-label="Dismiss" onClick={() => useStore.getState().dismissToast(t.id)} className="text-ink-400 hover:text-white"><X size={13} /></button>
          </div>
        );
      })}
    </div>
  );
}
