export default function SkeletonProfil() {
  return (
    <div className="responsive-padding py-6 max-w-lg mx-auto space-y-6">
      <div className="flex flex-col items-center gap-3">
        <div className="skeleton-image w-24 h-24 rounded-full" />
        <div className="skeleton-line large h-4 w-40" />
        <div className="skeleton-line small h-3 w-28" />
      </div>
      <div className="space-y-3">
        <div className="skeleton-line medium h-11 w-full" />
        <div className="skeleton-line medium h-11 w-full" />
        <div className="skeleton-line medium h-11 w-full" />
        <div className="skeleton-btn h-12 w-full" />
      </div>
    </div>
  );
}
