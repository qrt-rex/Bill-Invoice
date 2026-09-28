import { Plus, Trash2 } from 'lucide-react';
import { money } from '../lib/format';
import { Button } from '../ui/Button';

export interface ItemRow {
  particulars: string;
  hsn: string;
  quantity: string;
  rate: string;
}

const cell = 'h-9 w-full rounded-md border border-border bg-surface px-2.5 text-sm text-text focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/25 disabled:bg-surface-secondary disabled:text-text-muted';

export const lineAmount = (r: ItemRow) => Math.round((Number(r.quantity) || 0) * (Number(r.rate) || 0) * 100) / 100;

/** Line items as in invoice.php: add/remove rows, amount = qty x rate, at least one row. */
export function ItemsEditor({ rows, onChange, lockText = false, showHsn = true, newRow }: {
  rows: ItemRow[];
  onChange: (rows: ItemRow[]) => void;
  lockText?: boolean;
  showHsn?: boolean;
  newRow: () => ItemRow;
}) {
  const update = (i: number, patch: Partial<ItemRow>) => onChange(rows.map((r, n) => (n === i ? { ...r, ...patch } : r)));
  return (
    <div className="relative overflow-x-auto">
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs font-medium uppercase tracking-wider text-text-muted">
            <th className="w-10 px-3 py-2 text-center">#</th>
            <th className="px-2 py-2">Particulars</th>
            {showHsn && <th className="w-32 px-2 py-2">HSN</th>}
            <th className="w-24 px-2 py-2">Qty</th>
            <th className="w-36 px-2 py-2">Rate (₹)</th>
            <th className="w-36 px-2 py-2 text-right">Amount</th>
            <th className="w-12 px-2 py-2"><span className="sr-only">Remove</span></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-border last:border-0">
              <td className="px-3 py-2 text-center text-text-muted">{i + 1}</td>
              <td className="px-2 py-2">
                <input aria-label={`Particulars, row ${i + 1}`} className={cell} value={r.particulars} disabled={lockText} required
                  onChange={(e) => update(i, { particulars: e.target.value })} />
              </td>
              {showHsn && (
                <td className="px-2 py-2">
                  <input aria-label={`HSN, row ${i + 1}`} className={cell} value={r.hsn} disabled={lockText} onChange={(e) => update(i, { hsn: e.target.value })} />
                </td>
              )}
              <td className="px-2 py-2">
                <input aria-label={`Quantity, row ${i + 1}`} className={cell} type="number" min="1" step="1" value={r.quantity} required
                  onChange={(e) => update(i, { quantity: e.target.value })} />
              </td>
              <td className="px-2 py-2">
                <input aria-label={`Rate, row ${i + 1}`} className={cell} type="number" min="0" step="0.01" placeholder="0.00" value={r.rate} required
                  onChange={(e) => update(i, { rate: e.target.value })} />
              </td>
              <td className="px-2 py-2 text-right font-medium tabular-nums text-text">{money(lineAmount(r), true)}</td>
              <td className="px-2 py-2 text-center">
                <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove row ${i + 1}`} disabled={rows.length === 1}
                  onClick={() => onChange(rows.filter((_, n) => n !== i))}>
                  <Trash2 size={15} />
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="px-3 py-3">
        <Button type="button" variant="secondary" size="sm" onClick={() => onChange([...rows, newRow()])}><Plus size={15} /> Add row</Button>
      </div>
    </div>
  );
}
