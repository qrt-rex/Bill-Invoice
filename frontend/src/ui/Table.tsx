import { useMemo, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react';
import { Skeleton } from './Skeleton';

export interface Column<T> {
  key: string;
  header: ReactNode;
  render: (row: T) => ReactNode;
  /** Enables sorting; return the value to compare. */
  sortValue?: (row: T) => string | number;
  align?: 'left' | 'right' | 'center';
  className?: string;
}

interface TableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  loading?: boolean;
  empty?: ReactNode;
  onRowClick?: (row: T) => void;
  selection?: {
    selected: Set<string>;
    onChange: (next: Set<string>) => void;
  };
  caption?: string;
}

const alignClass = { left: 'text-left', right: 'text-right', center: 'text-center' };

export function Table<T>({ columns, rows, rowKey, loading, empty, onRowClick, selection, caption }: TableProps<T>) {
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' } | null>(null);

  const sorted = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    const sortValue = col?.sortValue;
    if (!sortValue) return rows;
    const factor = sort.dir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const [x, y] = [sortValue(a), sortValue(b)];
      return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true })) * factor;
    });
  }, [rows, sort, columns]);

  const toggleSort = (key: string) =>
    setSort((s) => (s?.key !== key ? { key, dir: 'asc' } : s.dir === 'asc' ? { key, dir: 'desc' } : null));

  const ids = rows.map(rowKey);
  const allSelected = !!selection && ids.length > 0 && ids.every((id) => selection.selected.has(id));
  const someSelected = !!selection && ids.some((id) => selection.selected.has(id));

  const toggleAll = () => {
    if (!selection) return;
    const next = new Set(selection.selected);
    ids.forEach((id) => (allSelected ? next.delete(id) : next.add(id)));
    selection.onChange(next);
  };
  const toggleOne = (id: string) => {
    if (!selection) return;
    const next = new Set(selection.selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    selection.onChange(next);
  };

  const colSpan = columns.length + (selection ? 1 : 0);

  return (
    <div className="max-h-[70vh] overflow-auto">
      <table className="w-full border-separate border-spacing-0 text-sm">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead className="sticky top-0 z-10">
          <tr>
            {selection && (
              <th scope="col" className="w-10 border-b border-border bg-surface-secondary px-4 py-2.5">
                <input
                  type="checkbox"
                  aria-label="Select all rows"
                  checked={allSelected}
                  ref={(el) => {
                    if (el) el.indeterminate = someSelected && !allSelected;
                  }}
                  onChange={toggleAll}
                  className="h-4 w-4 cursor-pointer accent-[var(--color-primary)]"
                />
              </th>
            )}
            {columns.map((col) => {
              const active = sort?.key === col.key;
              return (
                <th
                  key={col.key}
                  scope="col"
                  aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                  className={`whitespace-nowrap border-b border-border bg-surface-secondary px-4 py-2.5 text-xs font-medium text-text-muted ${alignClass[col.align ?? 'left']} ${col.className ?? ''}`}
                >
                  {col.sortValue ? (
                    <button
                      onClick={() => toggleSort(col.key)}
                      className={`-mx-1 inline-flex items-center gap-1 rounded px-1 hover:text-text ${active ? 'text-text' : ''}`}
                    >
                      {col.header}
                      {active ? (sort.dir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />) : <ChevronsUpDown size={12} className="opacity-50" />}
                    </button>
                  ) : col.header}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {loading &&
            Array.from({ length: 5 }).map((_, i) => (
              <tr key={`sk-${i}`}>
                <td colSpan={colSpan} className="border-b border-border px-4 py-3">
                  <Skeleton className="h-4 w-full" />
                </td>
              </tr>
            ))}
          {!loading && sorted.length === 0 && (
            <tr>
              <td colSpan={colSpan} className="px-4 py-2">{empty ?? <p className="py-10 text-center text-sm text-text-muted">No records to show.</p>}</td>
            </tr>
          )}
          {!loading &&
            sorted.map((row) => {
              const id = rowKey(row);
              const isSelected = selection?.selected.has(id);
              return (
                <tr
                  key={id}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={`group transition-colors ${isSelected ? 'bg-primary-soft/60' : 'hover:bg-surface-secondary'} ${onRowClick ? 'cursor-pointer' : ''}`}
                >
                  {selection && (
                    <td className="border-b border-border px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        aria-label="Select row"
                        checked={!!isSelected}
                        onChange={() => toggleOne(id)}
                        className="h-4 w-4 cursor-pointer accent-[var(--color-primary)]"
                      />
                    </td>
                  )}
                  {columns.map((col) => (
                    <td key={col.key} className={`border-b border-border px-4 py-3 align-middle text-text ${alignClass[col.align ?? 'left']} ${col.className ?? ''}`}>
                      {col.render(row)}
                    </td>
                  ))}
                </tr>
              );
            })}
        </tbody>
      </table>
    </div>
  );
}

interface PaginationProps {
  page: number;
  pageSize: number;
  total: number;
  onChange: (page: number) => void;
  noun?: string;
}

export function Pagination({ page, pageSize, total, onChange, noun = 'records' }: PaginationProps) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-2.5 text-xs text-text-muted">
      <span>{from}–{to} of {total} {noun}</span>
      <div className="flex items-center gap-1">
        <button
          disabled={page <= 1}
          onClick={() => onChange(page - 1)}
          className="rounded-md border border-border bg-surface px-2.5 py-1 font-medium text-text hover:bg-surface-secondary disabled:opacity-40"
        >
          Previous
        </button>
        <span className="px-2">Page {page} of {pages}</span>
        <button
          disabled={page >= pages}
          onClick={() => onChange(page + 1)}
          className="rounded-md border border-border bg-surface px-2.5 py-1 font-medium text-text hover:bg-surface-secondary disabled:opacity-40"
        >
          Next
        </button>
      </div>
    </div>
  );
}
