import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Inbox, Plus } from 'lucide-react';
import { useAuth } from '../auth';
import { BillingStatus, PageHeader, branchName, useMeta } from '../Shell';
import { api, ApiError } from '../lib/api';
import { dateTime, money } from '../lib/format';
import { useApi } from '../lib/useApi';
import type { InvoiceRequest } from '../lib/types';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { useConfirm } from '../ui/ConfirmDialog';
import { EmptyState } from '../ui/EmptyState';
import { ErrorState } from '../ui/ErrorState';
import { Input, Select, Textarea } from '../ui/Input';
import { Modal } from '../ui/Modal';
import { Table, type Column } from '../ui/Table';
import { useToast } from '../ui/ToastContext';
import { ItemsEditor, type ItemRow } from './ItemsEditor';

const blankRow = (): ItemRow => ({ particulars: '', hsn: '', quantity: '1', rate: '' });

/** request_invoice.php: a sales user asks an admin to issue a tax invoice. */
function NewRequestModal({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const meta = useMeta();
  const { user } = useAuth();
  const { showToast } = useToast();
  const empty = { billing_name: '', billing_address: '', billing_phone: '', client_gstin: '', client_state: '', branch_key: user?.branch_key ?? meta.branches[0].key, remark: '' };
  const [f, setF] = useState(empty);
  const [rows, setRows] = useState<ItemRow[]>([blankRow()]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (!f.billing_name.trim() || !f.billing_address.trim()) return setError('Enter the client name and address.');
    if (rows.some((r) => !r.particulars.trim() || !(Number(r.quantity) > 0) || r.rate === '')) return setError('Complete every item row.');
    setBusy(true);
    try {
      await api.post('/requests', { ...f, items: rows.map((r) => ({ particulars: r.particulars, quantity: Number(r.quantity), rate: Number(r.rate) })) });
      showToast('Invoice request submitted', 'success');
      setF(empty);
      setRows([blankRow()]);
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not submit the request.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} size="xl" title="Request a tax invoice" description="A billing admin reviews it and issues the invoice."
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" form="request-form" loading={busy}>Submit request</Button></>}>
      <form id="request-form" onSubmit={submit} noValidate className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Client name" required value={f.billing_name} onChange={set('billing_name')} />
          <Input label="Phone" value={f.billing_phone} onChange={set('billing_phone')} />
          <Textarea label="Address" required className="sm:col-span-2" value={f.billing_address} onChange={set('billing_address')} />
          <Input label="Client GSTIN" hint="Optional" maxLength={15} value={f.client_gstin} onChange={(e) => setF((x) => ({ ...x, client_gstin: e.target.value.toUpperCase() }))} />
          <Select label="Client state" value={f.client_state} onChange={set('client_state')}>
            <option value="">Select state</option>
            {meta.states.map((s) => <option key={s}>{s}</option>)}
          </Select>
          <Select label="Branch" value={f.branch_key} onChange={set('branch_key')}>
            {meta.branches.map((b) => <option key={b.key} value={b.key}>{b.display_name}</option>)}
          </Select>
          <Input label="Remark" value={f.remark} onChange={set('remark')} />
        </div>
        <div className="rounded-md border border-border">
          <ItemsEditor rows={rows} onChange={setRows} showHsn={false} newRow={blankRow} />
        </div>
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      </form>
    </Modal>
  );
}

export function Requests() {
  const { can } = useAuth();
  const meta = useMeta();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [params, setParams] = useSearchParams();
  const reviewer = can('requests.review');
  const [status, setStatus] = useState(reviewer ? 'pending' : '');
  const list = useApi(() => api.get<InvoiceRequest[]>('/requests', { status }), [status]);

  const reject = async (r: InvoiceRequest) => {
    if (!(await confirm({ title: `Reject request from ${r.requested_by_name}?`, tone: 'danger', confirmText: 'Reject', message: `${r.billing_name} · ${money(r.estimated_total, true)}` }))) return;
    try {
      await api.post(`/requests/${r.id}/reject`);
      showToast('Request rejected', 'success');
      list.reload();
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Could not reject the request.', 'error');
    }
  };

  const columns: Column<InvoiceRequest>[] = [
    { key: 'id', header: '#', render: (r) => <span className="text-text-muted">{r.id}</span> },
    { key: 'client', header: 'Client', render: (r) => <span className="font-medium text-text">{r.billing_name}</span> },
    { key: 'by', header: 'Requested by', render: (r) => r.requested_by_name || r.requested_by_email },
    { key: 'branch', header: 'Branch', render: (r) => branchName(meta, r.branch_key) },
    { key: 'amount', header: 'Estimated', align: 'right', render: (r) => <span className="tabular-nums">{money(r.estimated_total, true)}</span> },
    { key: 'date', header: 'Requested', render: (r) => <span className="whitespace-nowrap text-text-muted">{dateTime(r.created_at)}</span> },
    { key: 'status', header: 'Status', render: (r) => <BillingStatus status={r.status} /> },
    {
      key: 'actions', header: <span className="sr-only">Actions</span>, align: 'right', render: (r) => (
        <div className="flex justify-end gap-2">
          {r.status === 'pending' && reviewer && can('invoices.create_tax') && (
            <Button size="sm" onClick={() => navigate(`/invoices/new?request=${r.id}`)}>Approve</Button>
          )}
          {r.status === 'pending' && reviewer && <Button size="sm" variant="danger-ghost" onClick={() => reject(r)}>Reject</Button>}
          {r.invoice_id && <Link to={`/invoices/${r.invoice_id}`} className="text-xs font-medium text-primary hover:underline">Invoice</Link>}
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Invoice requests"
        description={reviewer ? 'Approving a request opens it as a tax invoice to check and save.' : 'Requests you have sent to a billing admin.'}
        actions={can('requests.create') && <Button onClick={() => setParams({ new: '1' })}><Plus size={16} /> Request invoice</Button>}
      />
      <Card>
        <div className="flex flex-wrap items-end gap-3 border-b border-border p-4">
          <Select label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
          </Select>
        </div>
        {list.status === 'error' ? <ErrorState message={list.error} onRetry={list.reload} /> : (
          <Table columns={columns} rows={list.data ?? []} rowKey={(r) => String(r.id)} loading={list.loading}
            empty={<EmptyState icon={Inbox} title="No requests" description={status ? `No ${status} requests.` : undefined} />} />
        )}
      </Card>
      {can('requests.create') && <NewRequestModal open={params.get('new') === '1'} onClose={() => setParams({})} onSaved={list.reload} />}
    </>
  );
}
