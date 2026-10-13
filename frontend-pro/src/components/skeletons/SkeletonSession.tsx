export default function SkeletonSession() {
  return (
    <div className="min-h-screen bg-[var(--color-bg,#F7F8FA)] flex flex-col">
      <div className="bg-[var(--color-primary,#0A5C36)] px-4 pt-10 pb-12">
        <div className="max-w-lg mx-auto space-y-3">
          <div className="skeleton-line h-7 w-48 bg-white/20" />
          <div className="skeleton-line h-4 w-64 bg-white/15" />
          <div className="skeleton-line h-12 w-full rounded-[var(--radius-xl,1rem)] bg-white/25 mt-4" />
        </div>
      </div>
      <div className="responsive-padding mt-6 max-w-lg mx-auto w-full space-y-4 px-4">
        <div className="skeleton-image h-[180px] w-full" />
        <div className="skeleton-line medium h-4 w-3/4" />
        <div className="skeleton-line small h-3 w-1/2" />
        <div className="skeleton-btn h-12 w-full" />
        <div className="skeleton-image h-[180px] w-full mt-4" />
        <div className="skeleton-line medium h-4 w-2/3" />
      </div>
    </div>
  );
}
