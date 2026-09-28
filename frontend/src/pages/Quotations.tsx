import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { FileSignature, Plus, Printer, Trash2 } from 'lucide-react';
import { useAuth } from '../auth';
import { PageHeader, useMeta } from '../Shell';
import { api, ApiError } from '../lib/api';
import { date, money, todayISO } from '../lib/format';
import { useApi } from '../lib/useApi';
import type { Quotation } from '../lib/types';
import { Button } from '../ui/Button';
import { Card, CardHeader } from '../ui/Card';
import { EmptyState } from '../ui/EmptyState';
import { ErrorState } from '../ui/ErrorState';
import { Input } from '../ui/Input';
import { PageSkeleton } from '../ui/Skeleton';
import { Table, type Column } from '../ui/Table';
import { useToast } from '../ui/ToastContext';

export function Quotations() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const list = useApi(() => api.get<Quotation[]>('/quotations'));
  const columns: Column<Quotation>[] = [
    { key: 'id', header: '#', render: (q) => <span className="text-text-muted">{q.id}</span> },
    { key: 'client', header: 'Client', render: (q) => <Link to={`/quotations/${q.id}`} className="font-medium text-primary hover:underline">{q.client_name}</Link> },
    { key: 'date', header: 'Date', render: (q) => date(q.quotation_date) },
    { key: 'by', header: 'Prepared by', render: (q) => q.employee_name },
    { key: 'terms', header: 'Payment terms', render: (q) => <span className="text-text-muted">{q.payment_terms || '—'}</span> },
    { key: 'total', header: 'Fees (excl. GST)', align: 'right', render: (q) => <span className="font-medium tabular-nums">{money(q.total_amount, true)}</span> },
  ];
  return (
    <>
      <PageHeader title="Quotations" description={can('quotations.view') ? 'All quotations.' : 'Quotations you have prepared.'}
        actions={can('quotations.create') && <Button onClick={() => navigate('/quotations/new')}><Plus size={16} /> New quotation</Button>} />
      <Card>
        {list.status === 'error' ? <ErrorState message={list.error} onRetry={list.reload} /> : (
          <Table columns={columns} rows={list.data ?? []} rowKey={(q) => String(q.id)} loading={list.loading}
            onRowClick={(q) => navigate(`/quotations/${q.id}`)}
            empty={<EmptyState icon={FileSignature} title="No quotations yet" />} />
        )}
      </Card>
    </>
  );
}

interface ServiceRow { service_name: string; amount: string; remarks: string }

/** quotation.php: services proposed, total professional fees (GST extra), payment terms. */
export function QuotationForm() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [f, setF] = useState({
    client_name: '', client_phone: '', client_email: '', quotation_date: todayISO(), total_amount: '', payment_terms: '',
    employee_name: user?.name ?? '', employee_phone: '', employee_email: user?.email ?? '',
  });
  const [services, setServices] = useState<ServiceRow[]>([{ service_name: '', amount: '', remarks: '' }]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const setService = (i: number, patch: Partial<ServiceRow>) => setServices((s) => s.map((r, n) => (n === i ? { ...r, ...patch } : r)));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    const filled = services.filter((s) => s.service_name.trim());
    if (!f.client_name.trim() || !f.quotation_date || !f.employee_name.trim() || !(Number(f.total_amount) > 0) || filled.length === 0) {
      return setError('Fill in client name, date, your name, total fees and at least one service.');
    }
    setBusy(true);
    try {
      const res = await api.post<{ id: number }>('/quotations', {
        ...f, total_amount: Number(f.total_amount), client_email: f.client_email || null, employee_email: f.employee_email || null,
        services: filled.map((s) => ({ ...s, amount: Number(s.amount) || 0 })),
      });
      showToast('Quotation saved', 'success');
      navigate(`/quotations/${res.id}`, { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save the quotation.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate>
      <PageHeader crumb={{ label: 'Quotations', to: '/quotations' }} title="New quotation" actions={<Button type="submit" loading={busy}>Save quotation</Button>} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Client" />
          <div className="grid gap-4 p-4 sm:grid-cols-2">
            <Input label="Client name" required className="sm:col-span-2" value={f.client_name} onChange={set('client_name')} />
            <Input label="Phone" hint="Optional" value={f.client_phone} onChange={set('client_phone')} />
            <Input label="Email" type="email" hint="Optional" value={f.client_email} onChange={set('client_email')} />
            <Input label="Quotation date" type="date" required value={f.quotation_date} onChange={set('quotation_date')} />
          </div>
        </Card>
        <Card>
          <CardHeader title="Fees and contact" />
          <div className="grid gap-4 p-4 sm:grid-cols-2">
            <Input label="Total professional fees (₹)" type="number" min="0" step="0.01" required value={f.total_amount} onChange={set('total_amount')} hint="GST not included" />
            <Input label="Payment terms" placeholder="e.g. 50% advance, 50% on completion" value={f.payment_terms} onChange={set('payment_terms')} />
            <Input label="Your name" required value={f.employee_name} onChange={set('employee_name')} />
            <Input label="Your phone" value={f.employee_phone} onChange={set('employee_phone')} />
            <Input label="Your email" type="email" className="sm:col-span-2" value={f.employee_email} onChange={set('employee_email')} />
          </div>
        </Card>
      </div>
      <Card className="mt-4">
        <CardHeader title="Services" />
        <div className="space-y-3 p-4">
          {services.map((s, i) => (
            <div key={i} className="grid items-end gap-3 sm:grid-cols-[1fr_160px_1fr_40px]">
              <Input label="Service" value={s.service_name} onChange={(e) => setService(i, { service_name: e.target.value })} />
              <Input label="Amount (₹)" type="number" min="0" step="0.01" value={s.amount} onChange={(e) => setService(i, { amount: e.target.value })} />
              <Input label="Remarks" value={s.remarks} onChange={(e) => setService(i, { remarks: e.target.value })} />
              <Button type="button" variant="ghost" size="icon" aria-label={`Remove service ${i + 1}`} disabled={services.length === 1}
                onClick={() => setServices((x) => x.filter((_, n) => n !== i))}><Trash2 size={15} /></Button>
            </div>
          ))}
          <Button type="button" variant="secondary" size="sm" onClick={() => setServices((x) => [...x, { service_name: '', amount: '', remarks: '' }])}>
            <Plus size={15} /> Add service
          </Button>
          {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        </div>
      </Card>
    </form>
  );
}

export function QuotationView() {
  const { id } = useParams();
  const { settings, branches } = useMeta();
  const q = useApi(() => api.get<Quotation>(`/quotations/${id}`), [id]);
  if (q.status === 'error') return <ErrorState message={q.error} onRetry={q.reload} />;
  if (!q.data) return <PageSkeleton />;
  const d = q.data;
  const head = branches.find((b) => b.key === 'ahmedabad_a') ?? branches[0];
  const h4 = 'mt-6 text-xs font-bold uppercase tracking-wider text-gray-900';

  return (
    <>
      <PageHeader crumb={{ label: 'Quotations', to: '/quotations' }} title={`Quotation for ${d.client_name}`} description={date(d.quotation_date)}
        actions={<Button variant="secondary" onClick={() => window.print()}><Printer size={16} /> Print / PDF</Button>} />
      <article className="doc mx-auto max-w-[860px] rounded-lg border border-gray-200 p-6 text-[13px] leading-relaxed shadow-sm sm:p-10">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b-2 border-gray-900 pb-4">
          <img src="/logo_web.png" alt="Rexera" className="h-10 w-auto" />
          <div className="text-right">
            <h1 className="text-2xl font-bold uppercase tracking-wide text-gray-900">Quotation</h1>
            <p className="text-gray-600">Date: {date(d.quotation_date)}</p>
          </div>
        </header>
        <section className="mt-4">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">Prepared for</p>
          <p className="text-base font-semibold text-gray-900">{d.client_name}</p>
          {d.client_phone && <p className="text-gray-700">Phone: {d.client_phone}</p>}
          {d.client_email && <p className="text-gray-700">Email: {d.client_email}</p>}
        </section>
        <h4 className={h4}>Services proposed</h4>
        <table className="mt-2 w-full border-collapse text-left">
          <thead>
            <tr className="bg-gray-900 text-[11px] uppercase tracking-wider text-white">
              <th className="px-3 py-2">#</th><th className="px-3 py-2">Service</th><th className="px-3 py-2 text-right">Amount (₹)</th><th className="px-3 py-2">Remarks</th>
            </tr>
          </thead>
          <tbody>
            {d.services?.map((s, i) => (
              <tr key={i} className="border-b border-gray-200">
                <td className="px-3 py-2">{i + 1}</td>
                <td className="px-3 py-2 font-medium text-gray-900">{s.service_name}</td>
                <td className="px-3 py-2 text-right tabular-nums">{Number(s.amount).toFixed(2)}</td>
                <td className="px-3 py-2">{s.remarks || '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
          <div className="text-gray-700">
            <p>Total professional fees: {money(d.total_amount, true)} (GST extra)</p>
            {d.payment_terms && <p>Terms: {d.payment_terms}</p>}
          </div>
          <div className="flex min-w-[240px] justify-between border-t-2 border-gray-900 pt-2 text-base font-bold text-gray-900">
            <span>Quotation total</span><span className="tabular-nums">{money(d.total_amount, true)}</span>
          </div>
        </div>
        <div className="mt-5 rounded-md border border-gray-200 p-4 text-gray-700">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">Contact person</p>
          <p><span className="font-medium">Name:</span> {d.employee_name}</p>
          {d.employee_phone && <p><span className="font-medium">Phone:</span> {d.employee_phone}</p>}
          {d.employee_email && <p><span className="font-medium">Email:</span> {d.employee_email}</p>}
        </div>
        <h4 className={h4}>Bank details</h4>
        <div className="mt-2 flex items-start justify-between gap-4 rounded-md border border-gray-200 p-4 text-gray-700">
          <div className="space-y-0.5">
            <p><span className="font-medium">Account name:</span> {settings.bank_account_name}</p>
            <p><span className="font-medium">Account no.:</span> {settings.bank_account_number}</p>
            <p><span className="font-medium">IFSC code:</span> {settings.bank_ifsc_code}</p>
            <p><span className="font-medium">Bank name:</span> {settings.bank_name}</p>
          </div>
          <img src="/qr_code.jpg" alt="UPI QR code" className="h-28 w-28 object-contain" />
        </div>
        <section className="mt-6 grid gap-6 break-inside-avoid text-gray-700 sm:grid-cols-2">
          <div>
            <h4 className="text-xs font-bold uppercase tracking-wider text-gray-900">About our company</h4>
            <p className="mt-2 font-semibold text-gray-900">Bridging Innovation and Success with Cutting-Edge Solutions.</p>
            <p className="mt-1">At REXERA FINANCIAL SERVICES, we are committed to empowering startups with the tools and expertise needed to thrive. From crafting compelling business plans and pitch decks to securing vital funding and driving strategic growth, our tailored solutions are designed to unlock your startup's full potential.</p>
            <p className="mt-2 font-medium text-gray-900">Business Growth · Analysis &amp; Research · 100% Secure</p>
          </div>
          <div>
            <h4 className="text-xs font-bold uppercase tracking-wider text-gray-900">Values we hold: vision &amp; mission</h4>
            <p className="mt-2 font-semibold text-gray-900">Our vision</p>
            <p>Our vision is to become the most trusted partner for startups worldwide, fostering a thriving ecosystem of innovation and entrepreneurship. We aim to bridge the gap between ideas and success, enabling startups to unlock their full potential, create lasting impact, and drive transformative change in the global market.</p>
            <p className="mt-2 font-semibold text-gray-900">Our mission</p>
            <p>Our mission is to empower startups by providing strategic financial guidance, innovative fundraising solutions, and tailored business development services. We are committed to helping entrepreneurs to turn their visions into reality, equipping them with the tools, expertise, and resources needed to navigate challenges, secure funding, and achieve sustainable growth.</p>
          </div>
          <div className="sm:col-span-2">
            <h4 className="text-xs font-bold uppercase tracking-wider text-gray-900">Why choose us?</h4>
            <p className="mt-1"><span className="font-semibold text-gray-900">Customized Strategies for Your Unique Needs.</span> We understand that each startup is unique. Our team works closely with you to craft customized strategies, whether you're in the early stages or scaling up. From business plans to pitch decks, we ensure your solutions align with your specific goals and challenges.</p>
          </div>
        </section>
        <footer className="mt-8 border-t border-gray-200 pt-3 text-center text-[11px] text-gray-500">
          <p>{head?.address}</p>
          <p>Phone: +91 {head?.phone} | Email: {settings.company_email} | Website: {settings.company_website}</p>
        </footer>
      </article>
    </>
  );
}
