/**
 * Skeleton shimmer — grille de créneaux (fiche terrain / sélection horaire).
 */
export default function SkeletonCreneaux({ count = 6 }: { count?: number }) {
  return (
    <div
      className="grid grid-cols-3 gap-2"
      aria-busy="true"
      aria-label="Chargement des créneaux"
    >
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="skeleton h-[52px] w-full rounded-xl" />
      ))}
    </div>
  );
}
