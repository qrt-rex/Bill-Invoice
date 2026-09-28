import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

interface StatCardProps {
  icon: LucideIcon;
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  to?: string;
  tone?: 'primary' | 'info' | 'success' | 'warning' | 'danger';
}

const iconTone = {
  primary: 'bg-primary-soft text-primary',
  info: 'bg-info-bg text-info',
  success: 'bg-success-bg text-success',
  warning: 'bg-warning-bg text-warning',
  danger: 'bg-danger-bg text-danger',
};

export function StatCard({ icon: Icon, label, value, hint, to, tone = 'primary' }: StatCardProps) {
  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-[13px] font-medium text-text-muted">{label}</p>
        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${iconTone[tone]}`}>
          <Icon size={16} aria-hidden="true" />
        </span>
      </div>
      {/* div, not p: `value` can be a Skeleton element while data loads */}
      <div className="mt-2 truncate text-2xl font-semibold tracking-tight text-text tabular-nums">{value}</div>
      {hint && <div className="mt-0.5 truncate text-xs text-text-muted">{hint}</div>}
    </>
  );

  const cls = 'block rounded-lg border border-border bg-surface p-4 shadow-[var(--shadow-card)]';
  return to ? (
    <Link to={to} className={`${cls} transition-colors hover:border-border-strong hover:bg-surface-secondary`}>{body}</Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}
