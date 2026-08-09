import SkeletonTerrainCard from "@/components/skeletons/SkeletonTerrainCard";

export default function SkeletonAccueil() {
  return (
    <div className="min-h-screen bg-[var(--bg)] pb-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <section className="rounded-2xl overflow-hidden bg-[var(--primary)] px-4 pt-6 pb-8 mt-1 h-[168px] md:h-[220px]">
          <div className="max-w-2xl space-y-3">
            <div className="skeleton-line h-5 w-40 bg-white/20" />
            <div className="skeleton-line h-6 w-56 bg-white/25" />
            <div className="skeleton-line h-10 w-full rounded-2xl bg-white/20 mt-2" />
          </div>
        </section>

        <div className="mt-2.5 flex gap-2 overflow-hidden">
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
