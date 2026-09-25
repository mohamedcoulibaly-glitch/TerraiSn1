/**
 * Skeleton shimmer pour la fiche terrain — préserve le layout (CLS).
 * Alias exporté aussi comme TerrainDetailSkeleton.
 */
export default function SkeletonFicheTerrain() {
  return (
    <div className="min-h-screen bg-[var(--bg)] page-enter pb-[120px]" aria-busy="true" aria-label="Chargement du terrain">
      <div className="relative h-[260px] sm:h-[300px] overflow-hidden">
        <div className="skeleton-image absolute inset-0 rounded-none" />
        <div className="absolute inset-0 bg-gradient-to-b from-black/20 via-transparent to-black/40 pointer-events-none" />
        <div className="absolute top-4 left-4 w-11 h-11 rounded-full skeleton-btn" />
        <div className="absolute top-4 right-4 w-11 h-11 rounded-full skeleton-btn" />
        <div className="absolute bottom-4 left-4 right-4 space-y-2">
          <div className="skeleton-line large h-6 w-2/3 bg-white/30" />
          <div className="skeleton-line small h-3 w-1/2 bg-white/20" />
        </div>
      </div>

      <div className="max-w-3xl mx-auto">
        <div className="mx-4 sm:mx-6 mt-4 rounded-2xl border border-gray-100 dark:border-[var(--border)] bg-[#F9FAFB] dark:bg-[var(--surface-2)] p-4 space-y-3">
          <div className="skeleton-line medium h-4 w-40" />
          <div className="flex gap-2 overflow-hidden">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="skeleton-btn h-[70px] w-[58px] rounded-xl shrink-0" />
            ))}
          </div>
        </div>

        <div className="mx-4 sm:mx-6 mt-4 rounded-2xl border border-gray-100 dark:border-[var(--border)] bg-[#F9FAFB] dark:bg-[var(--surface-2)] p-4 space-y-4">
          <div className="skeleton-line medium h-4 w-36" />
          <div className="grid grid-cols-2 gap-2">
            <div className="skeleton-btn h-16 rounded-xl" />
            <div className="skeleton-btn h-16 rounded-xl" />
          </div>
          <div className="flex gap-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="skeleton-btn h-11 flex-1 rounded-xl" />
            ))}
          </div>
          <div className="grid grid-cols-3 gap-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="skeleton-btn h-[52px] rounded-xl" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export { SkeletonFicheTerrain as TerrainDetailSkeleton };
