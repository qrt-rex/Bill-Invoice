import { TriangleAlert } from 'lucide-react';
import { Button } from './Button';

export function ErrorState({ onRetry, message, compact = false }: { onRetry?: () => void; message?: string; compact?: boolean }) {
  return (
    <div role="alert" className={`flex flex-col items-center text-center ${compact ? 'py-8' : 'py-14'}`}>
      <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-danger-bg text-danger">
        <TriangleAlert size={20} aria-hidden="true" />
      </div>
      <p className="text-sm font-medium text-text">Something went wrong</p>
      <p className="mt-1 max-w-sm text-sm text-text-muted">{message || "We couldn't load this data."}</p>
      {onRetry && <Button variant="secondary" size="sm" className="mt-4" onClick={onRetry}>Try again</Button>}
    </div>
  );
}
