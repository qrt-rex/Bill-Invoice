import { useState } from 'react';
import { Download } from 'lucide-react';
import { PageHeader } from '../Shell';
import { api, ApiError, saveBlob } from '../lib/api';
import { money, todayISO } from '../lib/format';
import { useApi } from '../lib/useApi';
import { Button } from '../ui/Button';
import { Card, CardHeader } from '../ui/Card';
import { ErrorState } from '../ui/ErrorState';
import { Input, Select } from '../ui/Input';
import { Table, type Column } from '../ui/Table';
import { useToast } from '../ui/ToastContext';

interface MonthRow { month: string; count: number; taxable: number; cgst: number; sgst: number; igst: number; total: number; received: number }
interface Summary {
  fy: string;
  fy_label: string;
  months: MonthRow[];
  totals: Omit<MonthRow, 'month'>;
  branches: { branch_key: string; branch: string; count: number; total: number }[];
}

function financialYears(count = 4) {
  const now = new Date();
  const start = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  return Array.from({ length: count }, (_, n) => {
    const y = start - n;
    return { id: `${String(y).slice(2)}${String(y + 1).slice(2)}`, label: `FY ${y}-${String(y + 1).slice(2)}` };
  });
}

const amount = (k: keyof MonthRow, header: string): Column<MonthRow> => ({
  key: k, header, align: 'right', render: (r) => <span className="tabular-nums">{money(r[k], true)}</span>,
});

export function Reports() {
  const { showToast } = useToast();
  const years = financialYears();
  const [fy, setFy] = useState(years[0].id);
  const [range, setRange] = useState({ date_from: todayISO().slice(0, 8) + '01', date_to: todayISO() });
  const report = useApi(() => api.get<Summary>('/reports/summary', { fy }), [fy]);

  const download = async () => {
    try {
      saveBlob(await api.blob('/reports/gst-register', range), `gst_register_${range.date_from}_${range.date_to}.csv`);
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Download failed.', 'error');
    }
  };

  const columns: Column<MonthRow>[] = [
    { key: 'month', header: 'Month', render: (r) => <span className="font-medium text-text">{r.month}</span> },
    { key: 'count', header: 'Invoices', align: 'right', render: (r) => r.count },
    amount('taxable', 'Taxable value'), amount('cgst', 'CGST'), amount('sgst', 'SGST'), amount('igst', 'IGST'),
    amount('total', 'Invoice total'), amount('received', 'Received'),
  ];
  const d = report.data;
  const rows = d ? [...d.months, { month: 'Total', ...d.totals }] : [];

  return (
    <>
      <PageHeader title="Reports" description="Tax invoices by month for GST filing, and money received."
        actions={
          <Select label="Financial year" value={fy} onChange={(e) => setFy(e.target.value)}>
            {years.map((y) => <option key={y.id} value={y.id}>{y.label}</option>)}
          </Select>
        } />
      {report.status === 'error' ? <ErrorState message={report.error} onRetry={report.reload} /> : (
        <div className="space-y-4">
          <Card>
            <CardHeader title={d ? `Monthly summary · ${d.fy_label}` : 'Monthly summary'} />
            <Table columns={columns} rows={rows} rowKey={(r) => r.month} loading={report.loading} />
          </Card>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader title="By branch" />
              <Table
                columns={[
                  { key: 'branch', header: 'Branch', render: (b) => <span className="font-medium text-text">{b.branch}</span> },
                  { key: 'count', header: 'Invoices', align: 'right', render: (b) => b.count },
                  { key: 'total', header: 'Invoice total', align: 'right', render: (b) => <span className="tabular-nums">{money(b.total, true)}</span> },
                ]}
                rows={d?.branches ?? []} rowKey={(b) => b.branch_key} loading={report.loading} />
            </Card>
            <Card>
              <CardHeader title="GST register" description="Every tax invoice in a date range, as a CSV for your accountant." />
              <div className="flex flex-wrap items-end gap-3 p-4">
                <Input label="From" type="date" value={range.date_from} onChange={(e) => setRange((r) => ({ ...r, date_from: e.target.value }))} />
                <Input label="To" type="date" value={range.date_to} onChange={(e) => setRange((r) => ({ ...r, date_to: e.target.value }))} />
                <Button variant="secondary" onClick={download}><Download size={16} /> Download CSV</Button>
              </div>
            </Card>
          </div>
        </div>
      )}
    </>
  );
}
