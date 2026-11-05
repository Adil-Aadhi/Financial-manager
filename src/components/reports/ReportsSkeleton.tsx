/** First-load placeholder inside the app shell. Filter changes keep the old render dimmed instead. */
export function ReportsSkeleton() {
  return (
    <div className="animate-pulse space-y-4 sm:space-y-5" aria-busy="true" aria-label="Loading reports">
      <div className="flex gap-2">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-9 w-24 shrink-0 rounded-full bg-glass-hover" />
        ))}
      </div>
      <div className="h-5 w-36 rounded-md bg-glass-hover" />
      <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-[92px] rounded-2xl border border-line bg-glass-hover" />
        ))}
      </div>
      <div className="h-72 rounded-2xl border border-line bg-glass-hover" />
      <div className="grid gap-4 sm:gap-5 lg:grid-cols-2">
        <div className="h-72 rounded-2xl border border-line bg-glass-hover" />
        <div className="h-72 rounded-2xl border border-line bg-glass-hover" />
      </div>
    </div>
  );
}
