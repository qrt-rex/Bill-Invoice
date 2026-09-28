import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';

const control =
  'w-full rounded-md border bg-surface px-3 text-sm text-text placeholder:text-text-muted/80 shadow-[var(--shadow-card)] transition-colors ' +
  'hover:border-border-strong focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/25 ' +
  'disabled:cursor-not-allowed disabled:bg-surface-secondary disabled:text-text-muted';

interface FieldProps {
  label?: ReactNode;
  hint?: ReactNode;
  error?: string;
  required?: boolean;
  className?: string;
}

function FieldShell({ id, label, hint, error, required, className = '', children }: FieldProps & { id: string; children: ReactNode }) {
  return (
    <div className={`flex min-w-0 flex-col gap-1.5 ${className}`}>
      {label && (
        <label htmlFor={id} className="text-[13px] font-medium text-text-secondary">
          {label}
          {required && <span className="ml-0.5 text-danger" aria-hidden="true">*</span>}
        </label>
      )}
      {children}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-xs text-danger">{error}</p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-xs text-text-muted">{hint}</p>
      ) : null}
    </div>
  );
}

const describedBy = (id: string, error?: string, hint?: ReactNode) => (error ? `${id}-error` : hint ? `${id}-hint` : undefined);

type InputProps = FieldProps & Omit<InputHTMLAttributes<HTMLInputElement>, 'className'> & { inputClassName?: string; leading?: ReactNode };

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, hint, error, required, className, inputClassName = '', leading, id: idProp, ...props },
  ref,
) {
  const generated = useId();
  const id = idProp ?? generated;
  return (
    <FieldShell id={id} label={label} hint={hint} error={error} required={required} className={className}>
      <div className="relative">
        {leading && <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted">{leading}</span>}
        <input
          ref={ref}
          id={id}
          required={required}
          aria-invalid={!!error || undefined}
          aria-describedby={describedBy(id, error, hint)}
          className={`${control} h-9 ${leading ? 'pl-9' : ''} ${error ? 'border-danger' : 'border-border'} ${inputClassName}`}
          {...props}
        />
      </div>
    </FieldShell>
  );
});

type SelectProps = FieldProps & Omit<SelectHTMLAttributes<HTMLSelectElement>, 'className'> & { selectClassName?: string };

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, hint, error, required, className, selectClassName = '', id: idProp, children, ...props },
  ref,
) {
  const generated = useId();
  const id = idProp ?? generated;
  return (
    <FieldShell id={id} label={label} hint={hint} error={error} required={required} className={className}>
      <select
        ref={ref}
        id={id}
        required={required}
        aria-invalid={!!error || undefined}
        aria-describedby={describedBy(id, error, hint)}
        className={`${control} h-9 cursor-pointer pr-8 ${error ? 'border-danger' : 'border-border'} ${selectClassName}`}
        {...props}
      >
        {children}
      </select>
    </FieldShell>
  );
});

type TextareaProps = FieldProps & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'className'>;

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { label, hint, error, required, className, id: idProp, rows = 3, ...props },
  ref,
) {
  const generated = useId();
  const id = idProp ?? generated;
  return (
    <FieldShell id={id} label={label} hint={hint} error={error} required={required} className={className}>
      <textarea
        ref={ref}
        id={id}
        rows={rows}
        required={required}
        aria-invalid={!!error || undefined}
        aria-describedby={describedBy(id, error, hint)}
        className={`${control} py-2 leading-5 ${error ? 'border-danger' : 'border-border'}`}
        {...props}
      />
    </FieldShell>
  );
});

type CheckboxProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'className'> & { label: ReactNode; description?: ReactNode; className?: string };

export function Checkbox({ label, description, className = '', id: idProp, ...props }: CheckboxProps) {
  const generated = useId();
  const id = idProp ?? generated;
  return (
    <label htmlFor={id} className={`flex cursor-pointer items-start gap-2.5 ${className}`}>
      <input id={id} type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-[var(--color-primary)]" {...props} />
      <span className="min-w-0">
        <span className="block text-sm text-text">{label}</span>
        {description && <span className="block text-xs text-text-muted">{description}</span>}
      </span>
    </label>
  );
}

/** Search box with icon, used in table toolbars. */
export function SearchInput({ value, onChange, placeholder, label }: { value: string; onChange: (v: string) => void; placeholder: string; label: string }) {
  return (
    <div className="relative w-full sm:w-72">
      <svg aria-hidden="true" viewBox="0 0 24 24" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 fill-none stroke-text-muted" strokeWidth="2" strokeLinecap="round">
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" />
      </svg>
      <input
        type="search"
        aria-label={label}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={`${control} h-9 border-border pl-9`}
      />
    </div>
  );
}
