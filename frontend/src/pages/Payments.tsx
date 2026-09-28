import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Plus, Wallet } from 'lucide-react';
import { useAuth } from '../auth';
import { PageHeader, useMeta } from '../Shell';
import { api, ApiError } from '../lib/api';
import { date, money, todayISO } from '../lib/format';
import { useApi } from '../lib/useApi';
import type { InvoiceSummary, Paged, Payment } from '../lib/types';
import { Button } from '../ui/Button';
import { Card, CardHeader } from '../ui/Card';
import { EmptyState } from '../ui/EmptyState';
import { ErrorState } from '../ui/ErrorState';
import { Input, Select } from '../ui/Input';
import { Modal } from '../ui/Modal';
import { Pagination, Table, type Column } from '../ui/Table';
import { useToast } from '../ui/ToastContext';

/**
 * Records a payment against a tax invoice. With `invoice` it is fixed; without, the user
 * picks one of the invoices that still have a balance.
 */
export function RecordPaymentModal({ open, onClose, onSaved, invoice }: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  invoice?: { id: number; invoice_number: string; balance: number };
}) {
  const { payment_modes } = useMeta();
  const { showToast } = useToast();
  const [invoiceId, setInvoiceId] = useState('');
  const [form, setForm] = useState({ amount: '', paid_on: todayISO(), mode: payment_modes[0], reference: '', note: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const open_ = useApi(async () => {
    const [unpaid, partial] = await Promise.all(['unpaid', 'partial'].map((s) =>
      api.get<Paged<InvoiceSummary>>('/invoices', { type: 'invoice', payment_status: s, page_size: 100 })));
    return [...unpaid.items, ...partial.items];
  }, [open], open && !invoice);

  const target = invoice ?? open_.data?.find((i) => String(i.id) === invoiceId);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (!target) return setError('Choose an invoice.');
    if (!(Number(form.amount) > 0)) return setError('Enter the amount received.');
    setBusy(true);
    try {
      await api.post(`/invoices/${target.id}/payments`, { ...form, amount: Number(form.amount) });
      showToast(`Payment recorded against ${target.invoice_number}`, 'success');
      setForm((f) => ({ ...f, amount: '', reference: '', note: '' }));
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not record the payment.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Record payment"
      description={target ? `${target.invoice_number} · balance ${money(target.balance, true)}` : 'Money received against a tax invoice.'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="payment-form" loading={busy}>Record payment</Button>
        </>
      }
    >
      <form id="payment-form" onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
        {!invoice && (
          <Select label="Invoice" required className="sm:col-span-2" value={invoiceId} onChange={(e) => setInvoiceId(e.target.value)}
            hint={open_.data && open_.data.length === 0 ? 'No invoices have a balance due.' : undefined}>
            <option value="">{open_.loading ? 'Loading…' : 'Select an invoice'}</option>
            {open_.data?.map((i) => (
              <option key={i.id} value={i.id}>{i.invoice_number} · {i.billing_name} · due {money(i.balance, true)}</option>
            ))}
          </Select>
        )}
        <Input label="Amount (₹)" type="number" min="0.01" step="0.01" required value={form.amount} onChange={set('amount')}
          hint={target ? <button type="button" className="text-primary hover:underline" onClick={() => setForm((f) => ({ ...f, amount: String(target.balance) }))}>Full balance</button> : undefined} />
        <Input label="Received on" type="date" required value={form.paid_on} onChange={set('paid_on')} />
        <Select label="Mode" value={form.mode} onChange={set('mode')}>
          {payment_modes.map((m) => <option key={m}>{m}</option>)}
        </Select>
        <Input label="Reference" placeholder="UTR / cheque no." value={form.reference} onChange={set('reference')} />
        <Input label="Note" className="sm:col-span-2" value={form.note} onChange={set('note')} />
        {error && <p role="alert" className="text-sm text-danger sm:col-span-2">{error}</p>}
      </form>
    </Modal>
  );
}

export function Payments() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const [page, setPage] = useState(1);
  const [range, setRange] = useState({ date_from: '', date_to: '' });
  const recording = params.get('record') === '1';
  const list = useApi(() => api.get<Paged<Payment> & { total_amount: number }>('/payments', { ...range, page }), [range, page]);

  const columns: Column<Payment>[] = [
    { key: 'paid_on', header: 'Date', render: (p) => <span className="whitespace-nowrap">{date(p.paid_on)}</span> },
    { key: 'invoice', header: 'Invoice', render: (p) => <Link to={`/invoices/${p.invoice_id}`} className="font-medium text-primary hover:underline">{p.invoice_number}</Link> },
    { key: 'customer', header: 'Customer', render: (p) => p.billing_name },
    { key: 'mode', header: 'Mode', render: (p) => p.mode },
    { key: 'reference', header: 'Reference', render: (p) => p.reference || '—' },
    { key: 'amount', header: 'Amount', align: 'right', render: (p) => <span className="font-medium tabular-nums">{money(p.amount, true)}</span> },
  ];

  return (
    <>
      <PageHeader
        title="Payments"
        description="Money received against tax invoices."
        actions={can('payments.record') && <Button onClick={() => setParams({ record: '1' })}><Plus size={16} /> Record payment</Button>}
      />
      <Card>
        <CardHeader
          title={list.data ? `${list.data.total} payments · ${money(list.data.total_amount, true)}` : 'Payments'}
          actions={
            <div className="flex flex-wrap items-end gap-2">
              <Input label="From" type="date" value={range.date_from} onChange={(e) => { setPage(1); setRange((r) => ({ ...r, date_from: e.target.value })); }} />
              <Input label="To" type="date" value={range.date_to} onChange={(e) => { setPage(1); setRange((r) => ({ ...r, date_to: e.target.value })); }} />
            </div>
          }
        />
        {list.status === 'error' ? <ErrorState message={list.error} onRetry={list.reload} /> : (
          <>
            <Table columns={columns} rows={list.data?.items ?? []} rowKey={(p) => String(p.id)} loading={list.loading}
              empty={<EmptyState icon={Wallet} title="No payments recorded" description="Payments you record against tax invoices appear here." />} />
            {list.data && <Pagination page={page} pageSize={list.data.page_size} total={list.data.total} onChange={setPage} noun="payments" />}
          </>
        )}
      </Card>
      {can('payments.record') && (
        <RecordPaymentModal open={recording} onClose={() => setParams({})} onSaved={list.reload} />
      )}
    </>
  );
}
