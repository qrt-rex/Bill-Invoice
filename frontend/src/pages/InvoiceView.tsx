import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Pencil, Printer, Trash2, Wallet } from 'lucide-react';
import { useAuth } from '../auth';
import { BillingStatus, PageHeader, TypeBadge } from '../Shell';
import { api, ApiError } from '../lib/api';
import { date, money } from '../lib/format';
import { useApi } from '../lib/useApi';
import type { InvoiceDetail } from '../lib/types';
import { Button } from '../ui/Button';
import { Card, CardHeader } from '../ui/Card';
import { useConfirm } from '../ui/ConfirmDialog';
import { ErrorState } from '../ui/ErrorState';
import { Input } from '../ui/Input';
import { Modal } from '../ui/Modal';
import { PageSkeleton } from '../ui/Skeleton';
import { useToast } from '../ui/ToastContext';
import { InvoiceDocument } from './InvoiceDocument';
import { RecordPaymentModal } from './Payments';

function EditRatesModal({ invoice, open, onClose, onSaved }: { invoice: InvoiceDetail; open: boolean; onClose: () => void; onSaved: (i: InvoiceDetail) => void }) {
  const { showToast } = useToast();
  const [rates, setRates] = useState<Record<number, string>>(() => Object.fromEntries(invoice.items.map((i) => [i.id, String(i.rate)])));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setError('');
    setBusy(true);
    try {
      const updated = await api.patch<InvoiceDetail>(`/invoices/${invoice.id}/rates`, {
        items: invoice.items.map((i) => ({ id: i.id, rate: Number(rates[i.id]) })),
      });
      showToast('Invoice updated; taxes recalculated', 'success');
      onSaved(updated);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update the invoice.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={`Edit rates · ${invoice.invoice_number}`}
      description="Quantities, parties and tax rates stay as issued. The change is recorded in the activity log."
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} loading={busy}>Save changes</Button></>}>
      <div className="space-y-3">
        {invoice.items.map((i) => (
          <div key={i.id} className="grid grid-cols-[1fr_140px] items-end gap-3">
            <div className="min-w-0 text-sm">
              <p className="truncate font-medium text-text">{i.particulars}</p>
              <p className="text-xs text-text-muted">Qty {Number(i.quantity)}</p>
            </div>
            <Input label="Rate (₹)" type="number" min="0" step="0.01" value={rates[i.id]} onChange={(e) => setRates((r) => ({ ...r, [i.id]: e.target.value }))} />
          </div>
        ))}
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      </div>
    </Modal>
  );
}

export function InvoiceView() {
  const { id } = useParams();
  const { can } = useAuth();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const inv = useApi(() => api.get<InvoiceDetail>(`/invoices/${id}`), [id]);
  const [editing, setEditing] = useState(false);
  const [paying, setPaying] = useState(false);

  if (inv.status === 'error') return <ErrorState message={inv.error} onRetry={inv.reload} />;
  if (!inv.data) return <PageSkeleton />;
  const i = inv.data;
  const isTax = i.invoice_type === 'invoice';

  const remove = async () => {
    const ok = await confirm({ title: `Delete ${i.invoice_number}?`, tone: 'danger', confirmText: 'Delete invoice',
      message: 'The invoice and its payments are removed. A copy is kept in the activity log.' });
    if (!ok) return;
    try {
      await api.delete(`/invoices/${i.id}`);
      showToast(`${i.invoice_number} deleted`, 'success');
      navigate('/invoices', { replace: true });
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Could not delete the invoice.', 'error');
    }
  };

  const removePayment = async (pid: number) => {
    if (!(await confirm({ title: 'Remove this payment?', tone: 'danger', confirmText: 'Remove', message: 'Use this to correct a payment recorded by mistake.' }))) return;
    try {
      await api.delete(`/payments/${pid}`);
      inv.reload();
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Could not remove the payment.', 'error');
    }
  };

  return (
    <>
      <PageHeader
        crumb={{ label: 'Invoices', to: '/invoices' }}
        title={<span className="flex flex-wrap items-center gap-2">{i.invoice_number} <TypeBadge type={i.invoice_type} /> {isTax && <BillingStatus status={i.payment_status} />}</span>}
        description={`${i.billing_name} · ${date(i.invoice_date)}`}
        actions={
          <>
            {isTax && can('payments.record') && i.balance > 0 && <Button onClick={() => setPaying(true)}><Wallet size={16} /> Record payment</Button>}
            <Button variant="secondary" onClick={() => window.print()}><Printer size={16} /> Print / PDF</Button>
            {isTax && can('invoices.edit') && <Button variant="secondary" onClick={() => setEditing(true)}><Pencil size={16} /> Edit rates</Button>}
            {isTax && can('invoices.delete') && <Button variant="danger-ghost" onClick={remove}><Trash2 size={16} /> Delete</Button>}
          </>
        }
      />

      <div className="grid gap-5 xl:grid-cols-[1fr_320px]">
        <InvoiceDocument invoice={i} />

        {isTax && can('payments.view') && (
          <Card className="no-print h-fit">
            <CardHeader title="Payments" description={i.payment_tracked
              ? `${money(i.paid, true)} received · ${money(i.balance, true)} due`
              : 'Issued before billing moved here; no payment history was kept.'} />
            {i.payments.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-text-muted">No payments recorded.</p>
            ) : (
              <ul className="divide-y divide-border">
                {i.payments.map((p) => (
                  <li key={p.id} className="flex items-start justify-between gap-3 px-4 py-3 text-sm">
                    <div className="min-w-0">
                      <p className="font-medium text-text tabular-nums">{money(p.amount, true)}</p>
                      <p className="truncate text-xs text-text-muted">{date(p.paid_on)} · {p.mode}{p.reference ? ` · ${p.reference}` : ''}</p>
                    </div>
                    {can('payments.record') && (
                      <button onClick={() => removePayment(p.id)} className="text-xs text-text-muted hover:text-danger" aria-label="Remove payment">Remove</button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}
      </div>

      {editing && <EditRatesModal invoice={i} open={editing} onClose={() => setEditing(false)} onSaved={inv.setData} />}
      <RecordPaymentModal open={paying} onClose={() => setPaying(false)} onSaved={inv.reload} invoice={i} />
    </>
  );
}
