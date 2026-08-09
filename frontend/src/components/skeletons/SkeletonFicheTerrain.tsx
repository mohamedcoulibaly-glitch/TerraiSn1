export default function SkeletonFicheTerrain() {
  return (
    <div className="page-container !pb-28">
      <div className="skeleton-image h-[240px] w-full rounded-none" />
      <div className="responsive-padding -mt-5 relative z-10 max-w-3xl mx-auto">
        <div className="bg-white rounded-[var(--radius-lg)] border border-[var(--color-border)] p-4 sm:p-6 space-y-4">
          <div className="skeleton-line large h-5 w-2/3" />
          <div className="skeleton-line small h-3 w-1/2" />
          <div className="flex gap-2">
            <div className="skeleton-line h-9 w-24 rounded-full" />
            <div className="skeleton-line h-9 w-28 rounded-full" />
            <div className="skeleton-line h-9 w-20 rounded-full" />
          </div>
        </div>
      </div>
      <div className="responsive-padding mt-6 max-w-3xl mx-auto space-y-3">
        <div className="skeleton-line medium h-4 w-32" />
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="skeleton-btn h-12 rounded-full" />
          ))}
        </div>
      </div>
    </div>
  );
}
