import { useEffect, useId, useLayoutEffect, useRef, useState, type ButtonHTMLAttributes, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface DropdownProps {
  /** Contents of the trigger button. */
  trigger: ReactNode;
  label: string;
  children: ReactNode;
  align?: 'left' | 'right';
  width?: string;
  triggerClassName?: string;
}

const GAP = 6;
const itemsOf = (menu: HTMLElement | null) =>
  Array.from(menu?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled]),[role="menuitemradio"]') ?? []);

/** Menu is portalled with fixed positioning so tables/scroll areas never clip it. */
export function Dropdown({ trigger, label, children, align = 'right', width = 'w-56', triggerClassName = '' }: DropdownProps) {
  const [open, setOpen] = useState(false);
  const [style, setStyle] = useState<CSSProperties>({ visibility: 'hidden' });
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useLayoutEffect(() => {
    if (!open || !button.current || !menu.current) return;
    const t = button.current.getBoundingClientRect();
    const m = menu.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = align === 'right' ? t.right - m.width : t.left;
    left = Math.min(Math.max(8, left), vw - m.width - 8);
    const below = t.bottom + GAP;
    const top = below + m.height > vh - 8 && t.top - GAP - m.height > 8 ? t.top - GAP - m.height : below;
    setStyle({ position: 'fixed', top, left });
  }, [open, align]);

  useEffect(() => {
    if (!open) return;
    const raf = requestAnimationFrame(() => itemsOf(menu.current)[0]?.focus()); // after positioning makes it visible
    const onPointer = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!menu.current?.contains(target) && !button.current?.contains(target)) setOpen(false);
    };
    const close = () => setOpen(false);
    document.addEventListener('mousedown', onPointer);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('mousedown', onPointer);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [open]);

  const close = (refocus: boolean) => {
    setOpen(false);
    setStyle({ visibility: 'hidden' });
    if (refocus) button.current?.focus();
  };

  const onMenuKey = (e: React.KeyboardEvent) => {
    const items = itemsOf(menu.current);
    const i = items.indexOf(document.activeElement as HTMLElement);
    const move = (to: number) => {
      e.preventDefault();
      items[(to + items.length) % items.length]?.focus();
    };
    if (e.key === 'ArrowDown') move(i + 1);
    else if (e.key === 'ArrowUp') move(i - 1);
    else if (e.key === 'Home') move(0);
    else if (e.key === 'End') move(items.length - 1);
    else if (e.key === 'Escape') {
      e.preventDefault();
      close(true);
    } else if (e.key === 'Tab') close(false);
  };

  return (
    <>
      <button
        ref={button}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => (open ? close(false) : setOpen(true))}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && !open) {
            e.preventDefault();
            setOpen(true);
          }
        }}
        className={`flex items-center rounded-md transition-colors ${triggerClassName}`}
      >
        {trigger}
      </button>
      {open &&
        createPortal(
          <div
            id={menuId}
            ref={menu}
            role="menu"
            aria-label={label}
            style={style}
            onKeyDown={onMenuKey}
            onClick={(e) => {
              if ((e.target as HTMLElement).closest('[role^="menuitem"]:not([data-keep-open])')) close(true);
            }}
            className={`z-[60] ${width} max-w-[calc(100vw-1rem)] rounded-lg border border-border bg-elevated p-1 shadow-[var(--shadow-pop)] animate-pop-in`}
          >
            {children}
          </div>,
          document.body,
        )}
    </>
  );
}

interface ItemProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon?: ReactNode;
  tone?: 'default' | 'danger';
  selected?: boolean;
  trailing?: ReactNode;
}

export function DropdownItem({ icon, tone = 'default', selected, trailing, children, className = '', ...props }: ItemProps) {
  const isRadio = selected !== undefined;
  return (
    <button
      type="button"
      role={isRadio ? 'menuitemradio' : 'menuitem'}
      aria-checked={isRadio ? selected : undefined}
      tabIndex={-1}
      className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm outline-none transition-colors
        hover:bg-neutral-bg focus-visible:bg-neutral-bg disabled:pointer-events-none disabled:opacity-50
        ${tone === 'danger' ? 'text-danger hover:bg-danger-bg focus-visible:bg-danger-bg' : 'text-text'} ${className}`}
      {...props}
    >
      {icon && <span className={`flex w-4 shrink-0 justify-center ${tone === 'danger' ? '' : 'text-text-muted'}`} aria-hidden="true">{icon}</span>}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {trailing}
    </button>
  );
}

export function DropdownLabel({ children }: { children: ReactNode }) {
  return <div className="px-2.5 pb-1 pt-1.5 text-xs font-medium text-text-muted">{children}</div>;
}

export function DropdownSeparator() {
  return <div role="separator" className="-mx-1 my-1 border-t border-border" />;
}
