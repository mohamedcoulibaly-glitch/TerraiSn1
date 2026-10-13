export default function SkeletonMesReservations() {
  return (
    <div className="flex flex-col gap-3">
      {Array.from({ length: 3 }).map((_, i) => (
        <div
          key={i}
          className="skeleton-card border border-[var(--color-border)] border-l-4 border-l-[var(--color-border)] rounded-[var(--radius-md)] bg-white p-4 space-y-3"
        >
          <div className="skeleton-line large h-4 w-2/3" />
          <div className="skeleton-line small h-3 w-1/2" />
          <div className="skeleton-line medium h-3 w-1/3" />
        </div>
      ))}
    </div>
  );
}
