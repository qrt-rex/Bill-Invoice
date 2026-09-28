import { Check, Monitor, Moon, Sun, type LucideIcon } from 'lucide-react';
import { useTheme, type ThemeMode } from './ThemeContext';
import { Dropdown, DropdownItem, DropdownLabel } from './Dropdown';
import { useToast } from './ToastContext';

function useSetThemeWithFeedback() {
  const { theme, setTheme } = useTheme();
  const { showToast } = useToast();
  return (mode: ThemeMode) => {
    if (mode === theme) return;
    setTheme(mode);
    showToast(`Theme changed to ${OPTIONS.find((o) => o.mode === mode)!.label}`, 'success');
  };
}

const OPTIONS: { mode: ThemeMode; label: string; description: string; icon: LucideIcon }[] = [
  { mode: 'light', label: 'Light', description: 'Bright surfaces for daytime work', icon: Sun },
  { mode: 'dark', label: 'Dark', description: 'Low-glare surfaces for long sessions', icon: Moon },
  { mode: 'system', label: 'System', description: 'Follow your operating system', icon: Monitor },
];

/** Compact header control: icon button that opens an "Appearance" menu. */
export function ThemeMenu() {
  const { theme, resolvedTheme } = useTheme();
  const setTheme = useSetThemeWithFeedback();
  const TriggerIcon = resolvedTheme === 'dark' ? Moon : Sun;
  const current = OPTIONS.find((o) => o.mode === theme)!;

  return (
    <Dropdown
      label={`Appearance: ${current.label}`}
      width="w-48"
      triggerClassName="h-9 w-9 justify-center text-text-muted hover:bg-neutral-bg hover:text-text"
      trigger={<TriggerIcon size={18} aria-hidden="true" />}
    >
      <DropdownLabel>Appearance</DropdownLabel>
      {OPTIONS.map((o) => (
        <DropdownItem
          key={o.mode}
          icon={<o.icon size={16} />}
          selected={theme === o.mode}
          onClick={() => setTheme(o.mode)}
          trailing={theme === o.mode ? <Check size={15} className="text-primary" aria-hidden="true" /> : null}
        >
          {o.label}
        </DropdownItem>
      ))}
    </Dropdown>
  );
}

/** Settings variant: a labelled radio list. */
export function ThemeOptions() {
  const { theme } = useTheme();
  const setTheme = useSetThemeWithFeedback();
  return (
    <fieldset>
      <legend className="sr-only">Theme</legend>
      <div className="grid gap-2 sm:grid-cols-3">
        {OPTIONS.map((o) => {
          const selected = theme === o.mode;
          return (
            <label
              key={o.mode}
              className={`relative flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors
                has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus
                ${selected ? 'border-primary bg-primary-soft/50' : 'border-border hover:border-border-strong hover:bg-surface-secondary'}`}
            >
              <input type="radio" name="theme" value={o.mode} checked={selected} onChange={() => setTheme(o.mode)} className="sr-only" />
              <o.icon size={18} className={`mt-0.5 shrink-0 ${selected ? 'text-primary' : 'text-text-muted'}`} aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-text">{o.label}</span>
                <span className="block text-xs text-text-muted">{o.description}</span>
              </span>
              {selected && <Check size={16} className="shrink-0 text-primary" aria-hidden="true" />}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
