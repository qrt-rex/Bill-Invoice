export function Skeleton({ className = '' }: { className?: string }) {
  return <div aria-hidden="true" className={`animate-pulse rounded-md bg-neutral-bg ${className}`} />;
}

/** Placeholder for a page body while its first request is in flight. */
export function PageSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[76px]" />)}
      </div>
      <Skeleton className="h-64" />
    </div>
  );
}
