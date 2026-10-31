import clsx from 'clsx';
import { forwardRef, memo, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { TONE_HEX, type Tone } from '../../lib/status';

type BtnVariant = 'primary' | 'ghost' | 'subtle' | 'danger' | 'success' | 'warn';

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; size?: 'xs' | 'sm' | 'md'; icon?: ReactNode }>(
  function Button({ variant = 'subtle', size = 'sm', icon, className, children, ...rest }, ref) {
    return (
      <button
        ref={ref}
        className={clsx(
          'inline-flex select-none items-center justify-center gap-1.5 rounded-lg font-medium transition-all duration-150 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-40',
          size === 'xs' && 'h-6 px-2 text-[11px]',
          size === 'sm' && 'h-7 px-2.5 text-xs',
          size === 'md' && 'h-9 px-3.5 text-sm',
          variant === 'primary' && 'bg-gradient-to-b from-blue-500 to-blue-600 text-white shadow-[0_0_0_1px_rgba(96,165,250,0.4),0_6px_20px_-6px_rgba(59,130,246,0.7)] hover:from-blue-400 hover:to-blue-500',
          variant === 'subtle' && 'border border-white/[0.08] bg-white/[0.04] text-ink-100 hover:border-white/[0.14] hover:bg-white/[0.08]',
          variant === 'ghost' && 'text-ink-200 hover:bg-white/[0.06] hover:text-white',
          variant === 'danger' && 'border border-red-500/30 bg-red-500/10 text-red-300 hover:bg-red-500/20',
          variant === 'success' && 'border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20',
          variant === 'warn' && 'border border-amber-500/30 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20',
          className,
        )}
        {...rest}
      >
        {icon}
        {children}
      </button>
    );
  },
);

export function IconButton({ label, className, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button aria-label={label} title={label} className={clsx('grid h-7 w-7 place-items-center rounded-lg text-ink-300 transition hover:bg-white/[0.07] hover:text-white active:scale-95 disabled:opacity-40', className)} {...rest}>
      {children}
    </button>
  );
}

export const StatusDot = memo(function StatusDot({ tone, pulse, size = 8 }: { tone: Tone; pulse?: boolean; size?: number }) {
  const c = TONE_HEX[tone];
  return (
    <span className={clsx('relative inline-block shrink-0 rounded-full', pulse && 'ring-pulse')} style={{ width: size, height: size, background: c, color: c, boxShadow: `0 0 ${size}px ${c}aa` }} />
  );
});

export function Pill({ tone, children, pulse, className }: { tone: Tone; children: ReactNode; pulse?: boolean; className?: string }) {
  const c = TONE_HEX[tone];
  return (
    <span className={clsx('inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-wider', className)} style={{ color: c, background: `${c}1a`, boxShadow: `inset 0 0 0 1px ${c}33` }}>
      <StatusDot tone={tone} pulse={pulse} size={6} />
      {children}
    </span>
  );
}

export function Badge({ children, className, color }: { children: ReactNode; className?: string; color?: string }) {
  return (
    <span className={clsx('inline-flex items-center gap-1 rounded-md border border-white/[0.08] bg-white/[0.04] px-1.5 py-0.5 text-[10px] font-medium text-ink-200', className)} style={color ? { color, borderColor: `${color}40`, background: `${color}14` } : undefined}>
      {children}
    </span>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded border border-white/10 bg-white/[0.05] px-1.5 py-px font-mono text-[10px] text-ink-300">{children}</kbd>;
}

export function Panel({ title, actions, children, className, bodyClassName }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; bodyClassName?: string }) {
  return (
    <section className={clsx('glass flex min-h-0 flex-col rounded-2xl', className)}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-2 border-b hairline px-4 py-2.5">
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-300">{title}</h3>
          <div className="flex items-center gap-1.5">{actions}</div>
        </header>
      )}
      <div className={clsx('min-h-0 flex-1', bodyClassName)}>{children}</div>
    </section>
  );
}

export function Tabs<T extends string>({ value, onChange, items, wrap }: { value: T; onChange: (v: T) => void; items: { id: T; label: string; icon?: ReactNode; count?: number }[]; wrap?: boolean }) {
  return (
    <div role="tablist" className={clsx('flex gap-0.5 rounded-xl border border-white/[0.06] bg-black/20 p-0.5', wrap ? 'flex-wrap' : 'overflow-x-auto')}>
      {items.map((i) => (
        <button
          key={i.id}
          role="tab"
          aria-selected={value === i.id}
          onClick={() => onChange(i.id)}
          className={clsx('flex shrink-0 items-center gap-1.5 rounded-[10px] px-2.5 py-1 text-[11px] font-medium transition', value === i.id ? 'bg-white/[0.09] text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]' : 'text-ink-300 hover:text-ink-100')}
        >
          {i.icon}
          {i.label}
          {i.count !== undefined && i.count > 0 && <span className="rounded bg-white/10 px-1 text-[9px]">{i.count}</span>}
        </button>
      ))}
    </div>
  );
}

export const Sparkline = memo(function Sparkline({ values, color = '#60a5fa', height = 36, max }: { values: number[]; color?: string; height?: number; max?: number }) {
  const w = 160;
  if (values.length < 2) return <div style={{ height }} className="grid place-items-center text-[10px] text-ink-400">collecting…</div>;
  const top = Math.max(max ?? 0, ...values, 1);
  const pts = values.map((v, i) => [(i / (values.length - 1)) * w, height - (v / top) * (height - 4) - 2]);
  const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const id = `sg${color.replace('#', '')}`;
  return (
    <svg viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" className="w-full" style={{ height }}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.35" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${d} L${w},${height} L0,${height} Z`} fill={`url(#${id})`} />
      <path d={d} fill="none" stroke={color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
});

export function Meter({ value, max, color = '#60a5fa', label }: { value: number; max: number; color?: string; label?: string }) {
  const pct = Math.max(0, Math.min(100, (value / Math.max(max, 1e-9)) * 100));
  return (
    <div className="w-full">
      {label && <div className="mb-1 flex justify-between text-[10px] text-ink-300"><span>{label}</span><span className="mono">{pct.toFixed(0)}%</span></div>}
      <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
        <div className="h-full rounded-full transition-[width] duration-700 ease-out" style={{ width: `${pct}%`, background: `linear-gradient(90deg, ${color}aa, ${color})`, boxShadow: `0 0 10px ${color}66` }} />
      </div>
    </div>
  );
}

export function Empty({ icon, title, body, action }: { icon?: ReactNode; title: string; body?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
      {icon && <div className="mb-1 text-ink-400">{icon}</div>}
      <div className="text-sm font-medium text-ink-100">{title}</div>
      {body && <div className="max-w-sm text-xs text-ink-300">{body}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

const fieldCls = 'w-full rounded-lg border border-white/[0.08] bg-black/30 px-2.5 py-1.5 text-sm text-ink-100 placeholder:text-ink-400 outline-none transition focus:border-blue-400/60 focus:ring-2 focus:ring-blue-500/20';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={clsx(fieldCls, className)} {...rest} />;
});
export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={clsx(fieldCls, 'resize-y', className)} {...rest} />;
}
export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={clsx(fieldCls, 'appearance-none bg-[length:12px] bg-[right_8px_center] bg-no-repeat pr-7', className)} style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E%3Cpath d='M3 4.5l3 3 3-3' fill='none' stroke='%238b96b4' stroke-width='1.5'/%3E%3C/svg%3E\")" }} {...rest}>
      {children}
    </select>
  );
}
export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-[11px] font-medium uppercase tracking-wider text-ink-300">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-ink-400">{hint}</span>}
    </label>
  );
}
export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)} className="inline-flex items-center gap-2 text-xs text-ink-200">
      <span className={clsx('relative h-4 w-7 rounded-full transition', checked ? 'bg-blue-500' : 'bg-white/15')}>
        <span className={clsx('absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition-all', checked ? 'left-3.5' : 'left-0.5')} />
      </span>
      {label}
    </button>
  );
}

export function Stat({ label, value, tone, sub }: { label: string; value: ReactNode; tone?: Tone; sub?: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="truncate text-[9px] font-semibold uppercase tracking-[0.16em] text-ink-400">{label}</div>
      <div className="mono flex items-baseline gap-1 text-[15px] font-semibold leading-tight tabular-nums" style={tone ? { color: TONE_HEX[tone] } : undefined}>
        {value}
        {sub && <span className="text-[10px] font-normal text-ink-400">{sub}</span>}
      </div>
    </div>
  );
}
