import { useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus, UserRound } from 'lucide-react';
import { useAuth } from '../auth';
import { PageHeader, branchName, useMeta } from '../Shell';
import { api, ApiError } from '../lib/api';
import { dateTime } from '../lib/format';
import { useApi } from '../lib/useApi';
import type { Branch, Paged } from '../lib/types';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Card, CardHeader } from '../ui/Card';
import { EmptyState } from '../ui/EmptyState';
import { ErrorState } from '../ui/ErrorState';
import { Checkbox, Input, Select, Textarea } from '../ui/Input';
import { Modal } from '../ui/Modal';
import { Pagination, Table, type Column } from '../ui/Table';
import { Tabs } from '../ui/Tabs';
import { useToast } from '../ui/ToastContext';

interface Member { id: number; email: string; full_name: string; job_role: string; role: string; branch_key: string | null; active: boolean }
interface AuditRow { id: number; at: string; actor_email: string; action: string; entity: string; entity_id: string; detail: string }

// Job roles offered by admin.php's create-user form.
const JOB_ROLES = ['Business Development Executive', 'Business Development Manager', 'Team Leader', 'Floor Manager', 'Branch Head'];

function MemberModal({ member, onClose, onSaved }: { member: Member | 'new'; onClose: () => void; onSaved: () => void }) {
  const meta = useMeta();
  const { showToast } = useToast();
  const isNew = member === 'new';
  const [f, setF] = useState(isNew
    ? { email: '', full_name: '', job_role: '', role: 'sales', branch_key: '', active: true }
    : { ...member, branch_key: member.branch_key ?? '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k: 'email' | 'full_name' | 'job_role' | 'role' | 'branch_key') => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    const body = { full_name: f.full_name, job_role: f.job_role, role: f.role, branch_key: f.branch_key || null, active: f.active };
    try {
      if (isNew) await api.post('/members', { ...body, email: f.email.trim() });
      else await api.patch(`/members/${member.id}`, body);
      showToast(isNew ? 'Billing access granted' : 'Member updated', 'success');
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={isNew ? 'Give billing access' : `Edit ${f.email}`}
      description={isNew ? 'The person signs in with their Rex CRM account (password and emailed code). Create that account first in Rex CRM if they do not have one.' : undefined}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" form="member-form" loading={busy}>Save</Button></>}>
      <form id="member-form" onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
        <Input label="Rex CRM email" type="email" required className="sm:col-span-2" value={f.email} onChange={set('email')} disabled={!isNew} />
        <Input label="Full name" value={f.full_name} onChange={set('full_name')} />
        <Select label="Job role" value={f.job_role} onChange={set('job_role')}>
          <option value="">Not set</option>
          {[...new Set([...JOB_ROLES, f.job_role].filter(Boolean))].map((j) => <option key={j}>{j}</option>)}
        </Select>
        <Select label="Billing role" value={f.role} onChange={set('role')}>
          {meta.roles.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
        </Select>
        <Select label="Default branch" value={f.branch_key} onChange={set('branch_key')}>
          <option value="">None</option>
          {meta.branches.map((b) => <option key={b.key} value={b.key}>{b.display_name}</option>)}
        </Select>
        {!isNew && <Checkbox className="sm:col-span-2" label="Active" description="Inactive members cannot open billing." checked={f.active} onChange={(e) => setF((x) => ({ ...x, active: e.target.checked }))} />}
        {error && <p role="alert" className="text-sm text-danger sm:col-span-2">{error}</p>}
      </form>
    </Modal>
  );
}

function MembersTab() {
  const meta = useMeta();
  const list = useApi(() => api.get<{ items: Member[] }>('/members'));
  const [editing, setEditing] = useState<Member | 'new' | null>(null);
  const role = (id: string) => meta.roles.find((r) => r.id === id)?.label ?? id;
  const columns: Column<Member>[] = [
    { key: 'name', header: 'Name', render: (m) => <div><p className="font-medium text-text">{m.full_name || m.email}</p><p className="text-xs text-text-muted">{m.email}</p></div> },
    { key: 'role', header: 'Billing role', render: (m) => <Badge tone={m.role === 'admin' ? 'primary' : 'neutral'}>{role(m.role)}</Badge> },
    { key: 'job', header: 'Job role', render: (m) => m.job_role || '—' },
    { key: 'branch', header: 'Branch', render: (m) => (m.branch_key ? branchName(meta, m.branch_key) : '—') },
    { key: 'status', header: 'Status', render: (m) => <Badge tone={m.active ? 'success' : 'neutral'} dot>{m.active ? 'Active' : 'Inactive'}</Badge> },
  ];
  return (
    <Card>
      <CardHeader title="Billing users" description="Accounts are shared with Rex CRM; roles here only control billing."
        actions={<Button size="sm" onClick={() => setEditing('new')}><Plus size={15} /> Give access</Button>} />
      {list.status === 'error' ? <ErrorState message={list.error} onRetry={list.reload} /> : (
        <Table columns={columns} rows={list.data?.items ?? []} rowKey={(m) => String(m.id)} loading={list.loading} onRowClick={setEditing}
          empty={<EmptyState icon={UserRound} title="No billing users yet" />} />
      )}
      {editing && <MemberModal member={editing} onClose={() => setEditing(null)} onSaved={list.reload} />}
    </Card>
  );
}

const COMPANY_FIELDS: [string, string][] = [
  ['company_name', 'Company name'], ['company_gstin', 'Company GSTIN'], ['company_email', 'Company email'], ['company_website', 'Website'],
  ['bank_account_name', 'Bank account name'], ['bank_account_number', 'Bank account number'], ['bank_ifsc_code', 'IFSC code'],
  ['bank_name', 'Bank name'], ['bank_upi_id', 'UPI ID'], ['default_particulars', 'Default invoice particulars'], ['default_hsn', 'Default HSN'],
];

function CompanyTab() {
  const meta = useMeta();
  const { showToast } = useToast();
  const [f, setF] = useState(meta.settings);
  const [busy, setBusy] = useState(false);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const saved = await api.put<Record<string, string>>('/settings', Object.fromEntries(COMPANY_FIELDS.map(([k]) => [k, f[k] ?? ''])));
      Object.assign(meta.settings, saved);
      showToast('Settings saved. New invoices use them.', 'success');
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Could not save settings.', 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      <CardHeader title="Company and bank details" description="Defaults for new invoices and quotations. Invoices already issued keep what they were issued with." />
      <form onSubmit={save} className="grid gap-4 p-4 sm:grid-cols-2">
        {COMPANY_FIELDS.map(([k, label]) => (
          <Input key={k} label={label} value={f[k] ?? ''} onChange={(e) => setF((x) => ({ ...x, [k]: e.target.value }))} />
        ))}
        <div className="flex justify-end sm:col-span-2"><Button type="submit" loading={busy}>Save settings</Button></div>
      </form>
    </Card>
  );
}

function BranchCard({ branch }: { branch: Branch }) {
  const { showToast } = useToast();
  const [f, setF] = useState(branch);
  const [busy, setBusy] = useState(false);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      Object.assign(branch, await api.put<Branch>(`/branches/${branch.key}`, f));
      showToast(`${f.display_name} saved`, 'success');
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Could not save the branch.', 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      <CardHeader title={branch.display_name} description={`Invoice series prefix ${branch.prefix}`} />
      <form onSubmit={save} className="grid gap-4 p-4 sm:grid-cols-2">
        <Input label="Display name" value={f.display_name} onChange={(e) => setF((x) => ({ ...x, display_name: e.target.value }))} />
        <Input label="Phone" value={f.phone} onChange={(e) => setF((x) => ({ ...x, phone: e.target.value }))} />
        <Input label="Legal name" className="sm:col-span-2" value={f.legal_name} onChange={(e) => setF((x) => ({ ...x, legal_name: e.target.value }))} />
        <Textarea label="Address" className="sm:col-span-2" value={f.address} onChange={(e) => setF((x) => ({ ...x, address: e.target.value }))} />
        <div className="flex justify-end sm:col-span-2"><Button type="submit" variant="secondary" loading={busy}>Save branch</Button></div>
      </form>
    </Card>
  );
}

function ActivityTab() {
  const [page, setPage] = useState(1);
  const list = useApi(() => api.get<Paged<AuditRow>>('/audit', { page }), [page]);
  const columns: Column<AuditRow>[] = [
    { key: 'at', header: 'When', render: (r) => <span className="whitespace-nowrap text-text-muted">{dateTime(r.at)}</span> },
    { key: 'who', header: 'Who', render: (r) => r.actor_email },
    { key: 'action', header: 'Action', render: (r) => <span className="font-medium text-text">{r.action.replace('.', ' · ').replace(/_/g, ' ')}</span> },
    { key: 'detail', header: 'Details', render: (r) => <span className="line-clamp-2 max-w-md break-all text-text-secondary">{r.detail || '—'}</span> },
  ];
  return (
    <Card>
      <CardHeader title="Activity" description="Every sensitive billing action: invoices issued, edited or deleted, payments, access changes." />
      {list.status === 'error' ? <ErrorState message={list.error} onRetry={list.reload} /> : (
        <>
          <Table columns={columns} rows={list.data?.items ?? []} rowKey={(r) => String(r.id)} loading={list.loading} empty={<EmptyState compact title="No activity yet" />} />
          {list.data && <Pagination page={page} pageSize={list.data.page_size} total={list.data.total} onChange={setPage} noun="events" />}
        </>
      )}
    </Card>
  );
}

export function Settings() {
  const { can } = useAuth();
  const meta = useMeta();
  const [params, setParams] = useSearchParams();
  const tabs = [
    can('members.manage') && { id: 'users', label: 'Users' },
    can('settings.manage') && { id: 'company', label: 'Company & bank' },
    can('settings.manage') && { id: 'branches', label: 'Branches' },
    can('audit.view') && { id: 'activity', label: 'Activity' },
  ].filter(Boolean) as { id: string; label: string }[];
  const active = tabs.find((t) => t.id === params.get('tab'))?.id ?? tabs[0]?.id;

  return (
    <>
      <PageHeader title="Settings" description="Billing administration." />
      <Tabs className="mb-4" tabs={tabs} active={active} onChange={(id) => setParams({ tab: id }, { replace: true })} />
      {active === 'users' && <MembersTab />}
      {active === 'company' && <CompanyTab />}
      {active === 'branches' && <div className="grid gap-4 lg:grid-cols-3">{meta.branches.map((b) => <BranchCard key={b.key} branch={b} />)}</div>}
      {active === 'activity' && <ActivityTab />}
    </>
  );
}
