import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth';
import { PageHeader, useMeta } from '../Shell';
import { api, ApiError } from '../lib/api';
import { money, todayISO } from '../lib/format';
import { useApi } from '../lib/useApi';
import type { InvoiceRequest, InvoiceType } from '../lib/types';
import { Button } from '../ui/Button';
import { Card, CardHeader } from '../ui/Card';
import { ErrorState } from '../ui/ErrorState';
import { Checkbox, Input, Select, Textarea } from '../ui/Input';
import { PageSkeleton } from '../ui/Skeleton';
import { useToast } from '../ui/ToastContext';
import { ItemsEditor, lineAmount, type ItemRow } from './ItemsEditor';

const round = (v: number) => Math.round(v * 100) / 100;

/** invoice.php (create) and approve_invoice.php (?request=ID): tax invoice or proforma. */
export function InvoiceForm() {
  const [params] = useSearchParams();
  const requestId = params.get('request');
  const request = useApi(() => api.get<InvoiceRequest>(`/requests/${requestId}`), [requestId], !!requestId);
  if (requestId && request.status === 'error') return <ErrorState message={request.error} onRetry={request.reload} />;
  if (requestId && !request.data) return <PageSkeleton />;
  return <Form request={request.data ?? undefined} initialType={params.get('type') === 'proforma' ? 'proforma' : undefined} />;
}

function Form({ request, initialType }: { request?: InvoiceRequest; initialType?: InvoiceType }) {
  const { can, user } = useAuth();
  const meta = useMeta();
  const s = meta.settings;
  const navigate = useNavigate();
  const { showToast } = useToast();
  const canTax = can('invoices.create_tax');
  const canPro = can('invoices.create_proforma');

  const newRow = (): ItemRow => ({ particulars: s.default_particulars, hsn: s.default_hsn, quantity: '1', rate: '' });
  const [type, setType] = useState<InvoiceType>(request ? 'invoice' : initialType && (initialType === 'proforma' ? canPro : canTax) ? initialType : canTax ? 'invoice' : 'proforma');
  const [f, setF] = useState({
    billing_name: request?.billing_name ?? '',
    billing_address: request?.billing_address ?? '',
    billing_phone: request?.billing_phone ?? '',
    client_gstin: request?.client_gstin ?? '',
    client_state: request?.client_state ?? '',
    invoice_date: todayISO(),
    branch_key: request?.branch_key ?? user?.branch_key ?? meta.branches[0].key,
    remark: request?.remark ?? '',
    bank_account_name: s.bank_account_name,
    bank_account_number: s.bank_account_number,
    bank_ifsc_code: s.bank_ifsc_code,
    bank_upi_id: s.bank_upi_id,
  });
  const [applyGst, setApplyGst] = useState(true);
  const [rows, setRows] = useState<ItemRow[]>(
    request?.items?.map((i) => ({ particulars: i.particulars, hsn: s.default_hsn, quantity: String(Number(i.quantity)), rate: String(i.rate) })) ?? [newRow()],
  );
  const [number, setNumber] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));

  useEffect(() => {
    if (!f.invoice_date) return;
    api.get<{ invoice_number: string }>('/invoices/next-number', { invoice_type: type, branch_key: f.branch_key, invoice_date: f.invoice_date })
      .then((r) => setNumber(r.invoice_number))
      .catch(() => setNumber(''));
  }, [type, f.branch_key, f.invoice_date]);

  // Same split as the server (which is what gets saved): CGST+SGST in the home state, IGST elsewhere.
  const sub = round(rows.reduce((t, r) => t + lineAmount(r), 0));
  const gst = applyGst && f.client_state;
  const inside = gst && f.client_state === meta.home_state;
  const cgst = inside ? round(sub * 0.09) : 0;
  const igst = gst && !inside ? round(sub * 0.18) : 0;
  const grand = round(sub + cgst * 2 + igst);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (!f.billing_name.trim() || !f.billing_address.trim()) return setError('Enter the client name and address.');
    if (applyGst && !f.client_state) return setError('Select the client state to apply GST, or untick Apply GST.');
    if (rows.some((r) => !r.particulars.trim() || !(Number(r.quantity) > 0) || r.rate === '' || Number(r.rate) < 0)) {
      return setError('Every row needs particulars, a quantity of at least 1 and a rate.');
    }
    setBusy(true);
    try {
      const res = await api.post<{ id: number; invoice_number: string }>('/invoices', {
        ...f, invoice_type: type, apply_gst: applyGst, client_state: applyGst ? f.client_state : '',
        request_id: request?.id,
        items: rows.map((r) => ({ particulars: r.particulars, hsn: r.hsn, quantity: Number(r.quantity), rate: Number(r.rate) })),
      });
      showToast(`${res.invoice_number} saved`, 'success');
      navigate(`/invoices/${res.id}`, { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save the invoice.');
    } finally {
      setBusy(false);
    }
  };

  const title = type === 'invoice' ? 'Tax invoice' : 'Proforma invoice';
  return (
    <form onSubmit={submit} noValidate>
      <PageHeader
        crumb={request ? { label: 'Invoice requests', to: '/requests' } : { label: 'Invoices', to: '/invoices' }}
        title={request ? `Approve request #${request.id}` : `New ${title.toLowerCase()}`}
        description={request ? `Requested by ${request.requested_by_name || request.requested_by_email}. Saving issues the tax invoice and marks the request approved.` : undefined}
        actions={<Button type="submit" loading={busy}>Save {title.toLowerCase()}</Button>}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Billing to" />
          <div className="grid gap-4 p-4 sm:grid-cols-2">
            <Input label="Client name" required className="sm:col-span-2" value={f.billing_name} onChange={set('billing_name')} />
            <Textarea label="Address" required className="sm:col-span-2" value={f.billing_address} onChange={set('billing_address')} />
            <Input label="Phone" value={f.billing_phone} onChange={set('billing_phone')} />
            <Input label="Client GSTIN" hint="Optional" value={f.client_gstin} maxLength={15}
              onChange={(e) => setF((x) => ({ ...x, client_gstin: e.target.value.toUpperCase() }))} />
          </div>
        </Card>

        <Card>
          <CardHeader title="Invoice details" />
          <div className="grid gap-4 p-4 sm:grid-cols-2">
            {!request && canTax && canPro ? (
              <Select label="Type" value={type} onChange={(e) => setType(e.target.value as InvoiceType)}>
                <option value="invoice">Tax invoice</option>
                <option value="proforma">Proforma invoice</option>
              </Select>
            ) : (
              <Input label="Type" value={title} disabled />
            )}
            <Input label="Invoice number" value={number} disabled hint="Final number is assigned on save." />
            <Input label="Invoice date" type="date" required value={f.invoice_date} onChange={set('invoice_date')} />
            <Select label="Branch" value={f.branch_key} onChange={set('branch_key')}>
              {meta.branches.map((b) => <option key={b.key} value={b.key}>{b.display_name}</option>)}
            </Select>
            <div className="space-y-3 rounded-md border border-border bg-surface-secondary p-3 sm:col-span-2">
              <Checkbox label="Apply GST to this invoice" description={`CGST 9% + SGST 9% within ${meta.home_state}, IGST 18% for other states.`}
                checked={applyGst} onChange={(e) => setApplyGst(e.target.checked)} />
              {applyGst && (
                <Select label="Client state" required value={f.client_state} onChange={set('client_state')}>
                  <option value="">Select state</option>
                  {meta.states.map((st) => <option key={st}>{st}</option>)}
                </Select>
              )}
            </div>
          </div>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader title="Items / particulars" description={can('settings.manage') || request ? undefined : 'Particulars and HSN come from billing settings.'} />
        <ItemsEditor rows={rows} onChange={setRows} newRow={newRow} lockText={!can('settings.manage') && !request} />
      </Card>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Bank details" />
          <div className="grid gap-4 p-4 sm:grid-cols-2">
            <Input label="Account name" value={f.bank_account_name} onChange={set('bank_account_name')} />
            <Input label="Account number" value={f.bank_account_number} onChange={set('bank_account_number')} />
            <Input label="IFSC code" value={f.bank_ifsc_code} onChange={set('bank_ifsc_code')} />
            <Input label="UPI ID" value={f.bank_upi_id} onChange={set('bank_upi_id')} />
            <Textarea label="Remarks / terms" className="sm:col-span-2" value={f.remark} onChange={set('remark')} />
          </div>
        </Card>
        <Card>
          <CardHeader title="Summary" />
          <dl className="space-y-2 p-4 text-sm">
            <div className="flex justify-between text-text-secondary"><dt>Sub-total</dt><dd className="tabular-nums">{money(sub, true)}</dd></div>
            {cgst > 0 && (
              <>
                <div className="flex justify-between text-text-secondary"><dt>CGST (9%)</dt><dd className="tabular-nums">{money(cgst, true)}</dd></div>
                <div className="flex justify-between text-text-secondary"><dt>SGST (9%)</dt><dd className="tabular-nums">{money(cgst, true)}</dd></div>
              </>
            )}
            {igst > 0 && <div className="flex justify-between text-text-secondary"><dt>IGST (18%)</dt><dd className="tabular-nums">{money(igst, true)}</dd></div>}
            <div className="flex justify-between border-t border-border pt-3 text-base font-semibold text-text"><dt>Grand total</dt><dd className="tabular-nums">{money(grand, true)}</dd></div>
          </dl>
          {error && <p role="alert" className="px-4 pb-2 text-sm text-danger">{error}</p>}
          <div className="flex justify-end border-t border-border p-4">
            <Button type="submit" loading={busy}>Save {title.toLowerCase()}</Button>
          </div>
        </Card>
      </div>
    </form>
  );
}
