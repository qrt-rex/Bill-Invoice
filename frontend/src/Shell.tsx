import { createContext, useContext, type ReactNode } from 'react';
import { Link, Outlet, useNavigate } from 'react-router-dom';
import { ChevronDown, ChevronRight, ExternalLink, LogOut } from 'lucide-react';
import { useAuth } from './auth';
import { api, MAIN_APP_URL } from './lib/api';
import { useApi } from './lib/useApi';
import type { Meta } from './lib/types';
import { Avatar } from './ui/Avatar';
import { Badge, type BadgeTone } from './ui/Badge';
import { Dropdown, DropdownItem, DropdownSeparator } from './ui/Dropdown';
import { ErrorState } from './ui/ErrorState';
import { PageSkeleton } from './ui/Skeleton';
import { ThemeMenu } from './ui/ThemeSelector';
import { useToast } from './ui/ToastContext';

/* Same shell as the main app's role dashboards: header only, no module sidebar.
   The dashboard is the control centre; every other page links back to it. */

const MetaContext = createContext<Meta | null>(null);

export function useMeta() {
  const meta = useContext(MetaContext);
  if (!meta) throw new Error('useMeta must be used inside Shell');
  return meta;
}

function UserMenu() {
  const { user, logout } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();
  if (!user) return null;
  const signOut = async () => {
    await logout('manual');
    navigate('/login', { replace: true });
    showToast('Signed out successfully', 'success');
  };
  return (
    <Dropdown
      label="Account menu"
      width="w-64"
      triggerClassName="h-9 gap-2 pl-1 pr-1.5 hover:bg-neutral-bg"
      trigger={
        <>
          <Avatar name={user.name} size={28} />
          <span className="hidden max-w-36 text-left leading-tight lg:block">
            <span className="block truncate text-[13px] font-medium text-text">{user.name}</span>
            <span className="block truncate text-xs text-text-muted">{user.role_label}</span>
          </span>
          <ChevronDown size={14} className="hidden text-text-muted lg:block" aria-hidden="true" />
        </>
      }
    >
      <div className="flex items-center gap-3 px-2.5 pb-2.5 pt-1.5">
        <Avatar name={user.name} size={36} />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-text">{user.name}</p>
          <p className="truncate text-xs text-text-muted">{user.role_label} · {user.email}</p>
        </div>
      </div>
      <DropdownSeparator />
      {MAIN_APP_URL && (
        <DropdownItem icon={<ExternalLink size={16} />} onClick={() => { window.location.href = MAIN_APP_URL; }}>
          Open Rex CRM
        </DropdownItem>
      )}
      <DropdownItem icon={<LogOut size={16} />} onClick={signOut} className="hover:!bg-danger-bg hover:!text-danger focus-visible:!bg-danger-bg focus-visible:!text-danger">
        Sign out
      </DropdownItem>
    </Dropdown>
  );
}

export function Shell() {
  const meta = useApi(() => api.get<Meta>('/meta'));
  return (
    <div className="flex min-h-screen flex-col bg-bg">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[70] focus:rounded-md focus:bg-elevated focus:px-3 focus:py-2 focus:text-sm">
        Skip to content
      </a>
      <header className="no-print sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b border-border bg-surface/95 px-3 backdrop-blur sm:px-4">
        <Link to="/dashboard" className="mr-1 flex items-center gap-2" aria-label="Rex Billing home">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-sm font-bold text-on-primary">R</span>
          <span className="text-[15px] font-semibold tracking-tight text-text">Rex Billing</span>
        </Link>
        {MAIN_APP_URL && (
          <a href={MAIN_APP_URL} className="ml-2 hidden items-center gap-1 text-xs font-medium text-text-muted hover:text-text sm:flex">
            Rex CRM <ExternalLink size={12} aria-hidden="true" />
          </a>
        )}
        <div className="ml-auto flex items-center gap-0.5">
          <ThemeMenu />
          <div className="mx-1.5 hidden h-6 w-px bg-border sm:block" aria-hidden="true" />
          <UserMenu />
        </div>
      </header>
      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 outline-none sm:px-6 lg:px-8">
        {meta.status === 'error' ? (
          <ErrorState message={meta.error} onRetry={meta.reload} />
        ) : !meta.data ? (
          <PageSkeleton />
        ) : (
          <MetaContext.Provider value={meta.data}>
            <Outlet />
          </MetaContext.Provider>
        )}
      </main>
    </div>
  );
}

export function PageHeader({ title, description, actions, crumb }: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  crumb?: { label: string; to: string };
}) {
  return (
    <div className="no-print mb-5">
      <nav aria-label="Breadcrumb" className="mb-1.5">
        <ol className="flex flex-wrap items-center gap-1 text-xs text-text-muted">
          <li><Link to="/dashboard" className="hover:text-text">Billing</Link></li>
          {crumb && (
            <li className="flex items-center gap-1">
              <ChevronRight size={12} aria-hidden="true" />
              <Link to={crumb.to} className="hover:text-text">{crumb.label}</Link>
            </li>
          )}
        </ol>
      </nav>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight text-text">{title}</h1>
          {description && <p className="mt-1 text-sm text-text-muted">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}

const PAYMENT_TONE: Record<string, [string, BadgeTone]> = {
  paid: ['Paid', 'success'],
  partial: ['Part paid', 'info'],
  unpaid: ['Unpaid', 'warning'],
  not_tracked: ['Not tracked', 'neutral'],
  proforma: ['Proforma', 'neutral'],
  pending: ['Pending', 'warning'],
  approved: ['Approved', 'success'],
  rejected: ['Rejected', 'danger'],
};

export function BillingStatus({ status }: { status: string }) {
  const [label, tone] = PAYMENT_TONE[status] ?? [status, 'neutral'];
  return <Badge tone={tone} dot>{label}</Badge>;
}

export function TypeBadge({ type }: { type: string }) {
  return <Badge tone={type === 'invoice' ? 'primary' : 'neutral'}>{type === 'invoice' ? 'Tax invoice' : 'Proforma'}</Badge>;
}

export function branchName(meta: Meta, key: string) {
  return meta.branches.find((b) => b.key === key)?.display_name ?? key;
}
