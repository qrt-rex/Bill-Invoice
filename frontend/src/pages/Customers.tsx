import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Users } from 'lucide-react';
import { useAuth } from '../auth';
import { PageHeader } from '../Shell';
import { api } from '../lib/api';
import { date, money } from '../lib/format';
import { useApi, useDebounced } from '../lib/useApi';
import { Card } from '../ui/Card';
import { EmptyState } from '../ui/EmptyState';
import { ErrorState } from '../ui/ErrorState';
import { SearchInput } from '../ui/Input';
import { Table, type Column } from '../ui/Table';

interface Customer {
  key: string;
  name: string;
  gstin: string;
  phone: string;
  state: string;
  address: string;
  invoices: number;
  billed: number;
  paid: number;
  outstanding: number;
  last_invoice_date: string;
}

export function Customers() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const search = useDebounced(q);
  const list = useApi(() => api.get<Customer[]>('/customers', { q: search }), [search]);

  const columns: Column<Customer>[] = [
    { key: 'name', header: 'Customer', render: (c) => (
      <div className="min-w-0">
        <p className="font-medium text-text">{c.name}</p>
        <p className="text-xs text-text-muted">{[c.gstin, c.state, c.phone].filter(Boolean).join(' · ') || '—'}</p>
      </div>
    ), sortValue: (c) => c.name.toLowerCase() },
    { key: 'invoices', header: 'Invoices', align: 'right', render: (c) => c.invoices, sortValue: (c) => c.invoices },
    { key: 'billed', header: 'Billed', align: 'right', render: (c) => <span className="tabular-nums">{money(c.billed, true)}</span>, sortValue: (c) => c.billed },
    { key: 'paid', header: 'Received', align: 'right', render: (c) => <span className="tabular-nums">{money(c.paid, true)}</span>, sortValue: (c) => c.paid },
    { key: 'outstanding', header: 'Outstanding', align: 'right', render: (c) => <span className={`tabular-nums ${c.outstanding > 0 ? 'font-medium text-warning' : ''}`}>{money(c.outstanding, true)}</span>, sortValue: (c) => c.outstanding },
    { key: 'last', header: 'Last invoice', align: 'right', render: (c) => <span className="whitespace-nowrap text-text-muted">{date(c.last_invoice_date)}</span>, sortValue: (c) => c.last_invoice_date },
  ];

  return (
    <>
      <PageHeader title="Customers" description="Everyone billed on a tax invoice, grouped by GSTIN (or name when there is none)." />
      <Card>
        <div className="border-b border-border p-4">
          <SearchInput label="Search customers" placeholder="Name, GSTIN or phone" value={q} onChange={setQ} />
        </div>
        {list.status === 'error' ? <ErrorState message={list.error} onRetry={list.reload} /> : (
          <Table columns={columns} rows={list.data ?? []} rowKey={(c) => c.key} loading={list.loading}
            onRowClick={can('invoices.view') ? (c) => navigate(`/invoices?${new URLSearchParams({ type: 'invoice', q: c.gstin || c.name })}`) : undefined}
            empty={<EmptyState icon={Users} title="No customers yet" description="Customers appear once a tax invoice is issued to them." />} />
        )}
      </Card>
    </>
  );
}
