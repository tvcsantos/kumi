import { Loader2, X } from 'lucide-react';
import { useEffect, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react';

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-accent text-accent-ink hover:brightness-110 shadow-sm',
  secondary: 'bg-panel text-ink border border-line hover:bg-sunken',
  ghost: 'text-muted hover:text-ink hover:bg-sunken',
  danger: 'bg-panel text-danger border border-line hover:bg-danger-soft',
};

export function Button({
  variant = 'secondary',
  size = 'md',
  loading,
  icon,
  className,
  children,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md'; loading?: boolean; icon?: ReactNode }) {
  return (
    <button
      type="button"
      disabled={disabled || loading}
      className={cx(
        'inline-flex items-center justify-center gap-1.5 rounded-full font-medium transition disabled:cursor-not-allowed disabled:opacity-50',
        size === 'sm' ? 'h-7 px-2.5 text-xs' : 'h-9 px-3.5 text-sm',
        VARIANTS[variant],
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="size-4 animate-spin" /> : icon}
      {children}
    </button>
  );
}

type Tone = 'neutral' | 'accent' | 'ok' | 'warn' | 'danger';

const TONES: Record<Tone, string> = {
  neutral: 'bg-sunken text-muted',
  accent: 'bg-accent-soft text-accent',
  ok: 'bg-ok-soft text-ok',
  warn: 'bg-warn-soft text-warn',
  danger: 'bg-danger-soft text-danger',
};

export function Badge({ tone = 'neutral', children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return (
    <span title={title} className={cx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap', TONES[tone])}>
      {children}
    </span>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 text-muted">
      <Loader2 className="size-4 animate-spin" />
      {label && <span>{label}</span>}
    </div>
  );
}

export function Callout({ tone, children, icon }: { tone: Tone; children: ReactNode; icon?: ReactNode }) {
  return <div className={cx('flex items-start gap-2 rounded-lg px-3 py-2 text-sm', TONES[tone])}>{icon && <span className="mt-0.5 shrink-0">{icon}</span>}<div className="min-w-0">{children}</div></div>;
}

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cx(
        'h-9 w-full rounded-lg border border-line bg-panel px-3 text-sm text-ink placeholder:text-muted/70 focus:border-accent focus:ring-3 focus:ring-accent/12 focus:outline-none',
        className,
      )}
      {...rest}
    />
  );
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cx('h-9 w-full rounded-lg border border-line bg-panel px-2.5 text-sm text-ink focus:border-accent focus:ring-3 focus:ring-accent/12 focus:outline-none', className)} {...rest}>
      {children}
    </select>
  );
}

export function Modal({ title, onClose, children, footer, wide }: { title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal className={cx('flex max-h-full w-full flex-col overflow-hidden rounded-2xl border border-line bg-panel shadow-2xl', wide ? 'max-w-4xl' : 'max-w-lg')}>
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <div className="min-w-0 font-semibold">{title}</div>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close" icon={<X className="size-4" />} />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex items-center justify-end gap-2 border-t border-line bg-sunken/50 px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

export function Empty({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
      {icon && <div className="text-muted">{icon}</div>}
      <div className="font-medium">{title}</div>
      {children && <div className="max-w-md text-sm text-muted">{children}</div>}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex items-end justify-between gap-4 pb-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}
