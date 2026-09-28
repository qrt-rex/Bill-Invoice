import type { ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { LucideIcon } from 'lucide-react';
import {
  BarChart3, CheckCircle2, ChevronRight, ClipboardList, Clock, FileSignature, FilePlus2, FileText, FolderOpen,
  IndianRupee, Inbox, Send, Settings, Users, Wallet,
} from 'lucide-react';
import { useAuth } from '../auth';
import { BillingStatus, TypeBadge } from '../Shell';
import { api } from '../lib/api';
import { date, greeting, money, relativeTime } from '../lib/format';
import { useApi } from '../lib/useApi';
import type { InvoiceRequest, InvoiceSummary, Payment, Quotation } from '../lib/types';
import { Button } from '../ui/Button';
import { Card, CardHeader } from '../ui/Card';
import { EmptyState } from '../ui/EmptyState';
import { ErrorState } from '../ui/ErrorState';
import { Skeleton } from '../ui/Skeleton';
import { StatCard } from '../ui/StatCard';
import { Table, type Column } from '../ui/Table';

interface DashboardData {
  fy: string;
  fy_label: string;
  recent_invoices: InvoiceSummary[];
  stats?: { billed: number; invoice_count: number; outstanding: number; pending_count: number; paid_count: number; untracked_count: number; received?: number };
  pending_payments?: InvoiceSummary[];
  recent_payments?: Payment[];
  requests?: InvoiceRequest[];
  pending_request_count?: number;
  my_quotations?: Quotation[];
}

// Billing areas, each shown only to roles holding one of its permissions.
const AREAS: { to: string; icon: LucideIcon; title: string; description: string; perms: string[] }[] = [
  { to: '/invoices', icon: FileText, title: 'Invoices', description: 'Tax and proforma invoices', perms: ['invoices.view', 'invoices.view_proforma', 'invoices.create_proforma'] },
  { to: '/requests', icon: Inbox, title: 'Invoice requests', description: 'Requests awaiting a tax invoice', perms: ['requests.create', 'requests.review'] },
  { to: '/quotations', icon: FileSignature, title: 'Quotations', description: 'Proposals sent to clients', perms: ['quotations.create', 'quotations.view'] },
  { to: '/customers', icon: Users, title: 'Customers', description: 'Billed parties and balances', perms: ['customers.view'] },
  { to: '/payments', icon: Wallet, title: 'Payments', description: 'Money received', perms: ['payments.view'] },
  { to: '/reports', icon: BarChart3, title: 'Reports', description: 'Monthly GST and collections', perms: ['reports.view'] },
  { to: '/documents', icon: FolderOpen, title: 'Documents', description: 'Shared files and resources', perms: ['documents.view'] },
  { to: '/settings', icon: Settings, title: 'Settings', description: 'Users, company, branches, activity', perms: ['members.manage', 'settings.manage', 'audit.view'] },
];

function SectionTitle({ children }: { children: ReactNode }) {
  return <h2 className="mb-3 mt-7 text-sm font-semibold uppercase tracking-wider text-text-muted first:mt-0">{children}</h2>;
}

function ListCard({ title, link, empty, children, count }: { title: string; link?: string; empty: string; children: ReactNode; count: number }) {
  return (
    <Card>
      <CardHeader title={title} actions={link && count > 0 ? <Link to={link} className="text-xs font-medium text-primary hover:underline">View all</Link> : undefined} />
      {count === 0 ? <EmptyState compact title={empty} /> : <ul className="divide-y divide-border">{children}</ul>}
    </Card>
  );
}

export function Dashboard() {
  const { user, can } = useAuth();
  const navigate = useNavigate();
  const dash = useApi(() => api.get<DashboardData>('/dashboard'));
  const d = dash.data;
  const first = (user?.name ?? '').split(/[\s@]/)[0];

  const invoiceColumns: Column<InvoiceSummary>[] = [
    { key: 'no', header: 'Invoice no.', render: (i) => <span className="font-medium text-text">{i.invoice_number}</span> },
    { key: 'customer', header: 'Customer', render: (i) => i.billing_name },
    { key: 'amount', header: 'Amount', align: 'right', render: (i) => <span className="tabular-nums">{money(i.grand_total, true)}</span> },
    { key: 'status', header: 'Status', render: (i) => (i.invoice_type === 'invoice' ? <BillingStatus status={i.payment_status} /> : <TypeBadge type={i.invoice_type} />) },
    { key: 'date', header: 'Date', align: 'right', render: (i) => <span className="whitespace-nowrap text-text-muted">{date(i.invoice_date)}</span> },
  ];
  const pendingColumns: Column<InvoiceSummary>[] = [
    { key: 'customer', header: 'Customer', render: (i) => <span className="font-medium text-text">{i.billing_name}</span> },
    { key: 'no', header: 'Invoice', render: (i) => i.invoice_number },
    { key: 'due', header: 'Balance', align: 'right', render: (i) => <span className="tabular-nums">{money(i.balance, true)}</span> },
    { key: 'age', header: 'Age', align: 'right', render: (i) => <span className="text-text-muted">{i.age_days} d</span> },
    { key: 'status', header: 'Status', render: (i) => <BillingStatus status={i.payment_status} /> },
  ];

  const actions = [
    can('invoices.create_tax') && { label: 'Create invoice', icon: FilePlus2, to: '/invoices/new' },
    !can('invoices.create_tax') && can('invoices.create_proforma') && { label: 'Create proforma', icon: FilePlus2, to: '/invoices/new?type=proforma' },
    can('requests.create') && { label: 'Request invoice', icon: Send, to: '/requests?new=1' },
    can('payments.record') && { label: 'Record payment', icon: Wallet, to: '/payments?record=1' },
    can('quotations.create') && { label: 'New quotation', icon: FileSignature, to: '/quotations/new' },
    can('reports.view') && { label: 'View reports', icon: BarChart3, to: '/reports' },
  ].filter(Boolean) as { label: string; icon: LucideIcon; to: string }[];

  return (
    <>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight text-text">{greeting()}, {first}</h1>
          <p className="mt-1 text-sm text-text-muted">
            <span className="font-medium text-text-secondary">{user?.role_label}</span>
            <span aria-hidden="true"> · </span>Billing{d ? ` · ${d.fy_label}` : ''}
          </p>
        </div>
        {actions.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            {actions.map((a, n) => (
              <Button key={a.label} variant={n === 0 ? 'primary' : 'secondary'} onClick={() => navigate(a.to)}>
                <a.icon size={16} aria-hidden="true" /> {a.label}
              </Button>
            ))}
          </div>
        )}
      </div>

      {dash.status === 'error' ? <ErrorState message={dash.error} onRetry={dash.reload} /> : !d ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">{[0, 1, 2, 3].map((n) => <Skeleton key={n} className="h-24" />)}</div>
      ) : (
        <>
          {d.stats && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard icon={IndianRupee} label="Total billed" value={money(d.stats.billed)} hint={`${d.stats.invoice_count} tax invoices this FY`} to="/reports" />
              <StatCard icon={Clock} tone="warning" label="Outstanding" value={money(d.stats.outstanding)}
                hint={d.stats.untracked_count ? `${d.stats.untracked_count} older invoices not tracked` : 'Across all open invoices'} to="/invoices?payment_status=unpaid" />
              <StatCard icon={CheckCircle2} tone="success" label="Paid invoices" value={d.stats.paid_count}
                hint={d.stats.received !== undefined ? `${money(d.stats.received)} received this FY` : 'This FY'} to="/invoices?payment_status=paid" />
              <StatCard icon={ClipboardList} tone="info" label="Pending invoices" value={d.stats.pending_count} hint="Unpaid or part paid" to="/invoices?payment_status=unpaid" />
            </div>
          )}

          <div className="mt-4 grid gap-4 lg:grid-cols-3">
            <div className="min-w-0 space-y-4 lg:col-span-2">
              <Card>
                <CardHeader title="Recent invoices" actions={<Link to="/invoices" className="text-xs font-medium text-primary hover:underline">View all</Link>} />
                <Table columns={invoiceColumns} rows={d.recent_invoices} rowKey={(i) => String(i.id)} onRowClick={(i) => navigate(`/invoices/${i.id}`)}
                  empty={<EmptyState compact icon={FileText} title="No invoices yet" />} />
              </Card>
              {d.pending_payments && (
                <Card>
                  <CardHeader title="Pending payments" description="Oldest first" actions={<Link to="/invoices?payment_status=unpaid" className="text-xs font-medium text-primary hover:underline">View all</Link>} />
                  <Table columns={pendingColumns} rows={d.pending_payments} rowKey={(i) => String(i.id)} onRowClick={(i) => navigate(`/invoices/${i.id}`)}
                    empty={<EmptyState compact icon={CheckCircle2} title="Nothing outstanding" />} />
                </Card>
              )}
            </div>

            <div className="min-w-0 space-y-4">
              {d.requests && (
                <ListCard title={can('requests.review') ? `Invoice requests awaiting review (${d.pending_request_count ?? 0})` : 'My invoice requests'}
                  link="/requests" empty={can('requests.review') ? 'No pending requests' : 'You have not requested any invoices'} count={d.requests.length}>
                  {d.requests.map((r) => (
                    <li key={r.id}>
                      <Link to={can('requests.review') && r.status === 'pending' ? `/invoices/new?request=${r.id}` : '/requests'} className="block px-4 py-3 hover:bg-surface-secondary">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-text">{r.billing_name}</p>
                            <p className="truncate text-xs text-text-muted">{r.requested_by_name} · {money(r.estimated_total, true)}</p>
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            <BillingStatus status={r.status} />
                            <span className="hidden text-xs text-text-muted sm:block">{relativeTime(r.created_at)}</span>
                          </div>
                        </div>
                      </Link>
                    </li>
                  ))}
                </ListCard>
              )}
              {d.recent_payments && (
                <ListCard title="Recent transactions" link="/payments" empty="No payments recorded yet" count={d.recent_payments.length}>
                  {d.recent_payments.map((p) => (
                    <li key={p.id}>
                      <Link to={`/invoices/${p.invoice_id}`} className="flex items-start justify-between gap-3 px-4 py-3 hover:bg-surface-secondary">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-text">{p.billing_name}</p>
                          <p className="truncate text-xs text-text-muted">{p.invoice_number} · {p.mode}</p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="text-sm font-medium tabular-nums text-success">{money(p.amount, true)}</p>
                          <p className="text-xs text-text-muted">{date(p.paid_on)}</p>
                        </div>
                      </Link>
                    </li>
                  ))}
                </ListCard>
              )}
              {d.my_quotations && (
                <ListCard title="My quotations" link="/quotations" empty="No quotations yet" count={d.my_quotations.length}>
                  {d.my_quotations.map((q) => (
                    <li key={q.id}>
                      <Link to={`/quotations/${q.id}`} className="flex items-start justify-between gap-3 px-4 py-3 hover:bg-surface-secondary">
                        <p className="truncate text-sm font-medium text-text">{q.client_name}</p>
                        <span className="shrink-0 text-sm tabular-nums text-text-secondary">{money(q.total_amount)}</span>
                      </Link>
                    </li>
                  ))}
                </ListCard>
              )}
            </div>
          </div>

          <SectionTitle>Billing areas</SectionTitle>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {AREAS.filter((a) => a.perms.some(can)).map((a) => (
              <Link key={a.to} to={a.to} className="group flex items-start gap-3 rounded-lg border border-border bg-surface p-4 shadow-[var(--shadow-card)] transition-colors hover:border-border-strong hover:bg-surface-secondary">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary-soft text-primary"><a.icon size={17} aria-hidden="true" /></span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-text">{a.title}</span>
                  <span className="block text-xs text-text-muted">{a.description}</span>
                </span>
                <ChevronRight size={16} className="mt-1 shrink-0 text-text-muted transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
              </Link>
            ))}
          </div>
        </>
      )}
    </>
  );
}
