/** Affiche clairement « Réservé le » vs « Jour du match ». */

function pad(n: number) {
  return String(n).padStart(2, "0");
}

export function formatMatchSlot(date?: string | null, heureDebut?: string | null, heureFin?: string | null) {
  if (!date) return "—";
  const day = new Date(`${String(date).slice(0, 10)}T12:00:00`);
  const dayLabel = Number.isNaN(day.getTime())
    ? String(date).slice(0, 10)
    : day.toLocaleDateString("fr-FR", {
        weekday: "short",
        day: "numeric",
        month: "short",
        year: "numeric",
      });
  const h1 = heureDebut ? String(heureDebut).slice(0, 5) : "";
  const h2 = heureFin ? String(heureFin).slice(0, 5) : "";
  const hours = h1 && h2 ? `${h1}–${h2}` : h1 || "";
  return hours ? `${dayLabel} · ${hours}` : dayLabel;
}

export function formatCreatedAt(createdAt?: string | number | null) {
  if (createdAt == null || createdAt === "") return null;
  const d =
    typeof createdAt === "number"
      ? new Date(createdAt)
      : new Date(String(createdAt).includes("T") ? String(createdAt) : String(createdAt).replace(" ", "T"));
  if (Number.isNaN(d.getTime())) return null;
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} à ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

type Props = {
  createdAt?: string | number | null;
  date?: string | null;
  heureDebut?: string | null;
  heureFin?: string | null;
  className?: string;
  compact?: boolean;
};

export default function ReservationDatesBlock({
  createdAt,
  date,
  heureDebut,
  heureFin,
  className = "",
  compact = false,
}: Props) {
  const created = formatCreatedAt(createdAt);
  const match = formatMatchSlot(date, heureDebut, heureFin);

  return (
    <div className={`space-y-1 ${className}`}>
      <p
        className={compact ? "text-[13px] font-semibold" : "text-[15px] font-semibold"}
        style={{ color: "var(--color-primary)", fontFamily: "var(--font-display)" }}
      >
        <span className="block text-[10px] font-medium uppercase tracking-wide opacity-70 mb-0.5">
          Jour du match
        </span>
        {match}
      </p>
      {created ? (
        <p className="text-[11px] text-[var(--color-text-muted)]">
          Réservé le : {created}
        </p>
      ) : null}
    </div>
  );
}
