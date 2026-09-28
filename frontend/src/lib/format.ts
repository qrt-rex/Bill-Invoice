export const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;

export const currentMonth = () => MONTHS[new Date().getMonth()];
export const currentYear = () => new Date().getFullYear();
export const todayISO = () => new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD in local time

const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const inrPaise = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = new Intl.NumberFormat('en-IN');

export const money = (v: unknown, withPaise = false) => (withPaise ? inrPaise : inr).format(Number(v) || 0);
export const number = (v: unknown) => num.format(Number(v) || 0);

export function date(v?: string | null) {
  if (!v) return '—';
  const d = new Date(v.length === 10 ? `${v}T00:00:00` : v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function dateTime(v?: string | null) {
  if (!v) return '—';
  const d = new Date(/[zZ]|[+-]\d\d:\d\d$/.test(v) ? v : `${v}Z`); // backend stores naive UTC
  return Number.isNaN(d.getTime())
    ? v
    : d.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function relativeTime(v?: string | null) {
  if (!v) return '';
  const d = new Date(/[zZ]|[+-]\d\d:\d\d$/.test(v) || v.length === 10 ? v : `${v}Z`);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (Number.isNaN(diff)) return v;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} h ago`;
  if (diff < 7 * 86400) return `${Math.floor(diff / 86400)} d ago`;
  return date(v);
}

export const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).map((p) => p[0]).slice(0, 2).join('').toUpperCase() || '?';

export function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

export const titleCase = (s: string) =>
  s.toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
