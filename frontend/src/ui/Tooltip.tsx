import { useId, useState, type ReactElement, cloneElement } from 'react';

/** Hover/focus tooltip; the child gets aria-describedby so screen readers announce it too. */
export function Tooltip({ label, side = 'bottom', children }: { label: string; side?: 'bottom' | 'right'; children: ReactElement<Record<string, unknown>> }) {
  const [visible, setVisible] = useState(false);
  const id = useId();
  const position = side === 'right'
    ? 'left-full top-1/2 ml-2 -translate-y-1/2'
    : 'left-1/2 top-full mt-2 -translate-x-1/2';

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
      onFocus={() => setVisible(true)}
      onBlur={() => setVisible(false)}
    >
      {cloneElement(children, { 'aria-describedby': id })}
      <span
        id={id}
        role="tooltip"
        className={`pointer-events-none absolute z-50 whitespace-nowrap rounded-md bg-text px-2 py-1 text-xs font-medium text-bg shadow-[var(--shadow-pop)] transition-opacity duration-100
          ${position} ${visible ? 'opacity-100' : 'opacity-0'}`}
      >
        {label}
      </span>
    </span>
  );
}
