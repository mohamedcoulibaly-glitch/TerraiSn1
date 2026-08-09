export default function SkeletonTerrainCard() {
  return (
    <div className="w-full bg-[var(--card-bg)] border border-[var(--card-border)] rounded-2xl overflow-hidden">
      <div className="h-[130px] skeleton bg-[var(--surface-2)]" />
      <div className="px-3 pt-2.5 pb-3 flex flex-col gap-2">
        <div className="skeleton h-4 w-3/4 bg-[var(--surface-2)] rounded-lg" />
        <div className="skeleton h-3 w-1/2 bg-[var(--surface-2)] rounded-lg" />
        <div className="flex gap-1.5">
          <div className="skeleton h-5 w-16 bg-[var(--surface-2)] rounded-full" />
          <div className="skeleton h-5 w-20 bg-[var(--surface-2)] rounded-full" />
        </div>
        <div className="flex items-center justify-between gap-3 mt-0.5">
          <div className="skeleton h-4 w-28 bg-[var(--surface-2)] rounded-lg" />
          <div className="skeleton h-9 w-24 bg-[var(--surface-2)] rounded-xl" />
        </div>
      </div>
    </div>
  );
}

export { SkeletonTerrainCard };
