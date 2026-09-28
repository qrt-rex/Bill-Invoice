import { useRef, type ReactNode } from 'react';

interface TabItem {
  id: string;
  label: ReactNode;
  count?: number;
}

/** Controlled tab bar with roving arrow-key navigation. Render the active panel yourself. */
export function Tabs({ tabs, active, onChange, className = '' }: { tabs: TabItem[]; active: string; onChange: (id: string) => void; className?: string }) {
  const list = useRef<HTMLDivElement>(null);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const i = tabs.findIndex((t) => t.id === active);
    const to = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : null;
    if (to === null) return;
    e.preventDefault();
    const next = tabs[(to + tabs.length) % tabs.length];
    onChange(next.id);
    list.current?.querySelector<HTMLElement>(`[data-tab="${next.id}"]`)?.focus();
  };

  return (
    <div ref={list} role="tablist" onKeyDown={onKeyDown} className={`flex gap-1 overflow-x-auto border-b border-border ${className}`}>
      {tabs.map((t) => {
        const selected = t.id === active;
        return (
          <button
            key={t.id}
            data-tab={t.id}
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(t.id)}
            className={`-mb-px inline-flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors
              ${selected ? 'border-primary text-text' : 'border-transparent text-text-muted hover:text-text'}`}
          >
            {t.label}
            {t.count !== undefined && (
              <span className={`rounded-full px-1.5 text-xs ${selected ? 'bg-primary-soft text-primary' : 'bg-neutral-bg text-text-muted'}`}>{t.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
