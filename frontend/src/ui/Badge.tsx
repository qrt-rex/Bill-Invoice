import type { ReactNode } from 'react';

export type BadgeTone = 'success' | 'warning' | 'danger' | 'info' | 'primary' | 'neutral';

const tones: Record<BadgeTone, string> = {
  success: 'bg-success-bg text-success',
  warning: 'bg-warning-bg text-warning',
  danger: 'bg-danger-bg text-danger',
  info: 'bg-info-bg text-info',
  primary: 'bg-primary-soft text-primary',
  neutral: 'bg-neutral-bg text-text-secondary',
};

const dots: Record<BadgeTone, string> = {
  success: 'bg-success', warning: 'bg-warning', danger: 'bg-danger',
  info: 'bg-info', primary: 'bg-primary', neutral: 'bg-text-muted',
};

export function Badge({ tone = 'neutral', dot = false, children }: { tone?: BadgeTone; dot?: boolean; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${tones[tone]}`}>
      {dot && <span className={`h-1.5 w-1.5 rounded-full ${dots[tone]}`} aria-hidden="true" />}
      {children}
    </span>
  );
}

/** Maps the many status vocabularies used across HR records to one visual language. */
export function statusTone(status?: string | null): BadgeTone {
  const s = (status ?? '').toUpperCase().replace(/[\s-]+/g, '_');
  if (['ACTIVE', 'APPROVED', 'PRESENT', 'PAID', 'COMPLETED', 'JOINED', 'SELECTED', 'SENT', 'ONGOING', 'FULLY_RECOVERED', 'OPTIMAL', 'CONVERTED_TO_FULL_TIME'].includes(s)) return 'success';
  if (['PENDING', 'LATE', 'HALF_DAY', 'PROBATION', 'ON_HOLD', 'UNDER_REVIEW', 'DRAFT', 'CALCULATED', 'SCREENING', 'INTERVIEW_SCHEDULED', 'INTERVIEWED', 'UNDERUTILIZED', 'BURNOUT_RISK', 'IMPORTANT', 'POLICY_UPDATE'].includes(s)) return 'warning';
  if (['REJECTED', 'ABSENT', 'TERMINATED', 'FAILED', 'DISCONTINUED', 'CRITICAL_EMERGENCY', 'BLOCKED'].includes(s)) return 'danger';
  if (['FINALIZED', 'APPLIED', 'ON_LEAVE', 'INFO'].includes(s)) return 'info';
  return 'neutral';
}

export function StatusBadge({ status }: { status?: string | null }) {
  const label = (status ?? '—').replace(/_/g, ' ');
  return <Badge tone={statusTone(status)} dot>{label.charAt(0) + label.slice(1).toLowerCase()}</Badge>;
}
