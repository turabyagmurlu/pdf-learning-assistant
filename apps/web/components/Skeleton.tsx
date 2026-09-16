/** Yukleme iskeleti: "Yükleniyor…" yazisi yerine icerigin silueti. */
export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={"animate-pulse rounded-lg bg-surface-muted " + className} aria-hidden="true" />;
}

export function CardSkeleton({ n = 3 }: { n?: number }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3" role="status" aria-label="Yükleniyor">
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} className="rounded-2xl border bg-surface p-4">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="mt-3 h-3 w-full" />
          <Skeleton className="mt-1.5 h-3 w-5/6" />
          <div className="mt-3 flex gap-1.5"><Skeleton className="h-5 w-12" /><Skeleton className="h-5 w-16" /><Skeleton className="h-5 w-14" /></div>
        </div>
      ))}
    </div>
  );
}
