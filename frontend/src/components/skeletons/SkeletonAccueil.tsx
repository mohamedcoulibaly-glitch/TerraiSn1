import SkeletonTerrainCard from "@/components/skeletons/SkeletonTerrainCard";

export default function SkeletonAccueil() {
  return (
    <div className="min-h-screen bg-[var(--bg)] pb-8">
      {/* Même bleed que le hero réel */}
      <div className="w-full md:max-w-7xl md:mx-auto md:px-6 lg:px-8">
        <section className="relative w-full overflow-hidden bg-[#0B1F17] h-[38vh] min-h-[280px] max-h-[440px] rounded-none m-0 md:h-[300px] md:rounded-3xl">
          <div className="absolute inset-0 skeleton opacity-40" />
          <div className="relative z-10 px-4 pt-[calc(0.75rem+env(safe-area-inset-top,0px))] space-y-3 md:px-8 md:pt-8">
            <div className="skeleton-line h-5 w-32 bg-white/20" />
            <div className="skeleton-line h-8 w-56 bg-white/25 mt-12 md:mt-16" />
            <div className="skeleton-line h-8 w-40 bg-white/20" />
          </div>
        </section>
        <div className="relative z-20 px-4 -mt-7 max-w-3xl md:mx-auto md:px-0">
          <div className="skeleton h-12 w-full rounded-2xl" />
        </div>
      </div>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="mt-4 flex gap-2 overflow-hidden">
          {[88, 104, 120, 80, 56, 96].map((w) => (
            <div
              key={w}
              className="skeleton h-8 flex-shrink-0 rounded-full bg-[var(--surface-2)]"
              style={{ width: w }}
            />
          ))}
        </div>

        <div className="mt-3 flex flex-col gap-3 w-[94%] mx-auto max-w-2xl">
          <SkeletonTerrainCard />
          <SkeletonTerrainCard />
        </div>
      </div>
    </div>
  );
}
