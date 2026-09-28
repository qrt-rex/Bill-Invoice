import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { CheckCircle2, Info, TriangleAlert, XCircle, X } from 'lucide-react';

export type ToastTone = 'success' | 'info' | 'warning' | 'error';

interface ToastOptions {
  duration?: number;
  action?: { label: string; onClick: () => void };
}

interface Toast extends ToastOptions {
  id: number;
  message: string;
  tone: ToastTone;
}

type ShowToast = (message: string, tone?: ToastTone, options?: ToastOptions) => void;

const ToastContext = createContext<{ showToast: ShowToast } | null>(null);

const icons = { success: CheckCircle2, info: Info, warning: TriangleAlert, error: XCircle };
const iconTone = { success: 'text-success', info: 'text-info', warning: 'text-warning', error: 'text-danger' };

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => setToasts((prev) => prev.filter((t) => t.id !== id)), []);

  const showToast = useCallback<ShowToast>((message, tone = 'success', options = {}) => {
    const id = nextId.current++;
    setToasts((prev) => [...prev.slice(-3), { id, message, tone, ...options }]);
    window.setTimeout(() => dismiss(id), options.duration ?? (tone === 'error' ? 6000 : 3500));
  }, [dismiss]);

  const value = useMemo(() => ({ showToast }), [showToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed inset-x-4 bottom-4 z-[100] flex flex-col items-end gap-2 sm:left-auto sm:right-4">
        {toasts.map((t) => {
          const Icon = icons[t.tone];
          return (
            <div
              key={t.id}
              role={t.tone === 'error' ? 'alert' : 'status'}
              className="pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-lg border border-border bg-elevated px-4 py-3 text-sm text-text shadow-[var(--shadow-pop)] animate-pop-in"
            >
              <Icon size={17} className={`mt-px shrink-0 ${iconTone[t.tone]}`} aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="leading-5">{t.message}</p>
                {t.action && (
                  <button
                    onClick={() => { t.action?.onClick(); dismiss(t.id); }}
                    className="mt-1.5 text-sm font-medium text-primary hover:underline"
                  >
                    {t.action.label}
                  </button>
                )}
              </div>
              <button
                onClick={() => dismiss(t.id)}
                aria-label="Dismiss notification"
                className="-mr-1 rounded p-0.5 text-text-muted hover:bg-neutral-bg hover:text-text"
              >
                <X size={14} />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}
