import {
  Banknote,
  CalendarCog,
  CalendarDays,
  Clock,
  CloudRain,
  PlusCircle,
  QrCode,
  Repeat,
  Trophy,
  User,
  Wrench,
} from "lucide-react";
import { useEffect, useMemo, useState, useCallback, Fragment } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { normalizeRole } from "@/auth/roles";
import { useAuth } from "@/hooks/use-auth";
import { gerantApi } from "@/lib/api";
import {
  calculerFenetreCheckIn,
  calculerFlagsMatch,
  idPrioriteScannable,
} from "@/lib/checkInFenetre";
import { localYmd, weekDates, formatJourCourt } from "@/lib/localDate";
import { useTerrainEvents } from "@/hooks/useTerrainEvents";
import {
  useGerantDashboard,
  useGerantToday,
  useGerantWeek,
  useGerantLiveInvalidate,
} from "@/hooks/useGerantLiveData";
import { estNuitProlongee, getJourPercu, trierCreneaux } from "@/utils/creneauLabel";
import BloquerCreneauModal from "@/espaces/backoffice/components/BloquerCreneauModal";
import ReservationExpressModal from "@/espaces/backoffice/components/ReservationExpressModal";
import EnAttentePaiementActions from "@/espaces/backoffice/components/EnAttentePaiementActions";
import ScannerModal from "@/espaces/backoffice/components/ScannerModal";
import ValidationManuelleModal from "@/espaces/backoffice/components/ValidationManuelleModal";
import PaymentLockGauge from "@/components/PaymentLockGauge";
import SilentSyncDot from "@/components/SilentSyncDot";

type TodayReservation = {
  id: number;
  code_reservation?: string | null;
  joueur_nom?: string | null;
  joueur_telephone?: string | null;
  date?: string;
  heure_debut: string;
  heure_fin: string;
  statut: string;
  qr_code_scanne_at?: string | null;
  fenetre_retard?: number | null;
  montant_avance?: number;
  montant_restant?: number;
  montant?: number;
  prix_total?: number;
  created_at?: string | null;
  verrou_expire_at?: number | null;
  terrain_id?: number | null;
  creneau_id?: number | null;
  /** Présent si card issue d'un blocage (Workflow 6) */
  blocage_id?: number;
  blocage_ids?: number[];
  groupe_id?: string | null;
  motif?: string | null;
  type_blocage?: string | null;
  libelle?: string | null;
  pending_count?: number;
};

type MatchStatus = "libre" | "reserve" | "en_cours" | "en_retard" | "termine" | "bloque" | "en_attente";

function timeToMinutes(value: string) {
  const [h, m] = String(value || "0:0")
    .slice(0, 5)
    .split(":")
    .map(Number);
  return h * 60 + (m || 0);
}

function formatHourRange(debut: string, fin: string) {
  const d = String(debut).slice(0, 5).replace(":", "h");
  const f = String(fin).slice(0, 5).replace(":", "h");
  return `${d} → ${f}`;
}

function formatEntreeValidee(value?: string | null) {
  if (!value) return "✅ Entrée validée";
  const raw = String(value).trim();
  const date = new Date(raw.includes("T") ? raw : raw.replace(" ", "T"));
  if (Number.isNaN(date.getTime())) return "✅ Entrée validée";
  const jour = date.toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  const heure = date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  return `✅ Entrée validée le ${jour} à ${heure}`;
}

function toCreneau(resa: TodayReservation, dayDate: string) {
  return {
    date: resa.date || dayDate,
    heure_debut: resa.heure_debut,
    heure_fin: resa.heure_fin,
    fenetre_retard: resa.fenetre_retard,
  };
}

/**
 * Statut d'affichage de la card — calculé côté front selon l'heure courante (Workflow 1 + 7).
 * Sans scan : jamais « en cours » — dès l'heure de début → « en retard ».
 */
function resolveLiveStatus(resa: TodayReservation, dayDate: string, nowMs: number): MatchStatus {
  if (resa.statut === "libre") return "libre";
  if (resa.statut === "en_attente") return "en_attente";

  const creneau = toCreneau(resa, dayDate);

  // Abonnement / tournoi / blocage : même flux horaire — passé → terminé (masqué comme les autres)
  if (resa.statut === "bloque" || resa.statut === "blocked") {
    const { heureFinMs } = calculerFenetreCheckIn(creneau);
    if (nowMs > heureFinMs) return "termine";
    return "bloque";
  }

  const flags = calculerFlagsMatch(creneau, resa.statut, nowMs);
  const scanned =
    Boolean(resa.qr_code_scanne_at) || ["match_joue", "joue"].includes(String(resa.statut || ""));

  // Après scan → En cours jusqu'à fin+retard, puis Terminé
  if (scanned) {
    const { heureFinMs, retardMin } = calculerFenetreCheckIn(creneau);
    if (nowMs > heureFinMs + retardMin * 60 * 1000 || flags.estTerminee) return "termine";
    return "en_cours";
  }

  if (["confirme", "acceptee"].includes(resa.statut)) {
    const { heureDebutMs, heureFinMs, retardMin } = calculerFenetreCheckIn(creneau);
    if (nowMs > heureFinMs + retardMin * 60 * 1000) return "termine";
    // Heure de début atteinte sans scan → en retard (pas en cours)
    if (nowMs >= heureDebutMs) return "en_retard";
    return "reserve";
  }
  return "libre";
}

const STATUS_UI: Record<
  MatchStatus,
  { label: string; color: string; bg: string }
> = {
  libre: { label: "Libre", color: "var(--g-libre)", bg: "var(--g-libre-bg)" },
  reserve: { label: "Réservé ✓", color: "var(--g-reserve)", bg: "var(--g-reserve-bg)" },
  en_cours: { label: "En cours ⚽", color: "var(--g-en-cours)", bg: "var(--g-en-cours-bg)" },
  en_retard: {
    label: "En retard ⏰",
    color: "var(--g-warning)",
    bg: "var(--g-en-cours-bg)",
  },
  termine: { label: "Terminé ✓", color: "var(--g-termine)", bg: "var(--g-termine-bg)" },
  bloque: { label: "Indisponible", color: "var(--g-danger)", bg: "color-mix(in srgb, var(--g-danger) 14%, transparent)" },
  en_attente: {
    label: "En attente de paiement",
    color: "var(--g-en-attente)",
    bg: "var(--g-en-attente-bg)",
  },
};

type QueueBlock = "imminente" | "en_cours" | "libre" | "reserve" | "en_attente" | "termine" | "bloque";

function minutesCeil(fromMs: number, toMs: number) {
  return Math.max(0, Math.ceil((toMs - fromMs) / 60000));
}

function isSlotInPast(date: string, heureDebut: string, nowMs: number) {
  const { heureDebutMs } = calculerFenetreCheckIn({ date, heure_debut: heureDebut, heure_fin: heureDebut });
  return nowMs >= heureDebutMs;
}

/**
 * Bloc d'affichage — l'ordre métier de la file (Correction 3).
 * Non scanné (imminent ou en retard) reste dans « imminente » pour garder le scanner.
 * « En cours » = uniquement après scan.
 */
function resolveQueueBlock(resa: TodayReservation, dayDate: string, nowMs: number): QueueBlock {
  const status = resolveLiveStatus(resa, dayDate, nowMs);
  if (status === "libre") return "libre";
  if (status === "bloque") return "bloque";
  if (status === "en_attente") return "en_attente";
  if (status === "termine") return "termine";
  if (status === "en_cours") return "en_cours";
  if (status === "en_retard") return "imminente";
  if (status === "reserve") {
    const creneau = toCreneau(resa, dayDate);
    const flags = calculerFlagsMatch(creneau, resa.statut, nowMs);
    if (!resa.qr_code_scanne_at && flags.estImminente) return "imminente";
    return "reserve";
  }
  return "reserve";
}

type QueueCardProps = {
  resa: TodayReservation;
  dayDate: string;
  nowMs: number;
  canScanNow: boolean;
  prioriteHeure?: string | null;
  prioriteJoueur?: string | null;
  features?: Record<string, boolean> | null;
  onScan: (resa: TodayReservation) => void;
  onExpress: (prefill: { date?: string; heure_debut?: string; heure_fin?: string }) => void;
  onUnblock: (id?: number | number[]) => void;
  onOpenDetail: (id: number) => void;
  onRefresh?: () => void;
};

function blocageKind(resa: TodayReservation): "abonnement" | "tournoi" | "indispo" {
  const t = String(resa.type_blocage || "").toUpperCase();
  if (t === "ABONNEMENT") return "abonnement";
  if (t === "TOURNOI") return "tournoi";
  return "indispo";
}

function QueueCard({
  resa,
  dayDate,
  nowMs,
  canScanNow,
  prioriteHeure,
  prioriteJoueur,
  features,
  onScan,
  onExpress,
  onUnblock,
  onOpenDetail,
  onRefresh,
}: QueueCardProps) {
  const creneau = toCreneau(resa, dayDate);
  const fenetre = calculerFenetreCheckIn(creneau);
  const block = resolveQueueBlock(resa, dayDate, nowMs);
  const status = resolveLiveStatus(resa, dayDate, nowMs);
  const ui = STATUS_UI[status];
  const pendingCount = Number(resa.pending_count || 1);
  const minutesToStart = minutesCeil(nowMs, fenetre.heureDebutMs);
  const minutesLeft = minutesCeil(nowMs, fenetre.heureFinMs + fenetre.retardMin * 60 * 1000);
  const reste = Number(resa.montant_restant ?? 0);
  const isImminente = block === "imminente";
  const dejaScanne = Boolean(resa.qr_code_scanne_at);
  const kind = status === "bloque" ? blocageKind(resa) : null;
  const leftColor =
    kind === "abonnement"
      ? "var(--g-info)"
      : kind === "tournoi"
        ? "var(--g-accent)"
        : kind === "indispo"
          ? "var(--g-danger)"
          : status === "en_retard"
            ? "var(--g-warning)"
            : isImminente
              ? "var(--g-primary)"
              : ui.color;
  const badge =
    kind === "abonnement"
      ? { label: "Abonnement", color: "var(--g-info)", bg: "color-mix(in srgb, var(--g-info) 14%, transparent)" }
      : kind === "tournoi"
        ? { label: "Tournoi", color: "var(--g-accent)", bg: "color-mix(in srgb, var(--g-accent) 14%, transparent)" }
        : kind === "indispo"
          ? { label: "Indisponible", color: "var(--g-danger)", bg: "color-mix(in srgb, var(--g-danger) 14%, transparent)" }
          : {
              label:
                status === "en_attente"
                  ? `En attente de paiement (${pendingCount} joueur${pendingCount > 1 ? "s" : ""})`
                  : ui.label,
              color: ui.color,
              bg: ui.bg,
            };

  const nuitPercu = estNuitProlongee(resa.heure_debut)
    ? getJourPercu(String(resa.date || dayDate).slice(0, 10), String(resa.heure_debut).slice(0, 5))
    : null;

  return (
    <li
      className={`rounded-2xl p-3.5 ${isImminente ? "g-card-imminente" : ""}`}
      style={{
        background: nuitPercu
          ? "rgba(79, 70, 229, 0.06)"
          : status === "en_retard"
            ? "color-mix(in srgb, var(--g-warning) 10%, var(--g-surface))"
            : isImminente
              ? "rgba(5,150,105,0.08)"
              : "var(--g-surface)",
        boxShadow: "var(--g-shadow)",
        borderLeft: `4px solid ${leftColor}`,
        opacity: block === "termine" ? 0.5 : 1,
      }}
    >
      {isImminente ? (
        <p
          className="text-[11px] font-bold mb-1.5"
          style={{ color: status === "en_retard" ? "var(--g-warning)" : "var(--g-primary)" }}
        >
          {status === "en_retard"
            ? `En retard — +${Math.max(1, Math.ceil((nowMs - fenetre.heureDebutMs) / 60000))} min ⏰`
            : minutesToStart <= 0
              ? "Maintenant ⚡"
              : `Dans ${minutesToStart} minute${minutesToStart > 1 ? "s" : ""} ⚡`}
        </p>
      ) : null}

      <div className="flex items-start justify-between gap-2">
        <div>
          <p
            className="text-lg font-bold"
            style={{ fontFamily: "var(--font-display)", color: "var(--g-text)" }}
          >
            {formatHourRange(resa.heure_debut, resa.heure_fin)}
          </p>
          {!resa.blocage_id && resa.created_at ? (
            <p className="text-[11px] mt-0.5" style={{ color: "var(--g-muted)" }}>
              Réservé le :{" "}
              {new Date(
                String(resa.created_at).includes("T")
                  ? resa.created_at
                  : String(resa.created_at).replace(" ", "T"),
              ).toLocaleString("fr-FR", {
                day: "2-digit",
                month: "2-digit",
                year: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </p>
          ) : null}
          {block === "en_cours" ? (
            <p className="text-[11px] font-semibold mt-0.5" style={{ color: "var(--g-en-cours)" }}>
              Encore ~{Math.max(1, minutesLeft)} min
            </p>
          ) : null}
          {status === "bloque" ? (
            <p className="text-[11px] mt-0.5 inline-flex items-center gap-1" style={{ color: "var(--g-muted)" }}>
              {kind === "abonnement" ? <Repeat className="w-3.5 h-3.5" style={{ color: "var(--g-info)" }} /> : null}
              {kind === "tournoi" ? <Trophy className="w-3.5 h-3.5" style={{ color: "var(--g-accent)" }} /> : null}
              {kind === "indispo" ? (
                String(resa.motif) === "maintenance" ? (
                  <Wrench className="w-3.5 h-3.5" style={{ color: "var(--g-danger)" }} />
                ) : (
                  <CloudRain className="w-3.5 h-3.5" style={{ color: "var(--g-danger)" }} />
                )
              ) : null}
              {resa.type_blocage === "ABONNEMENT"
                ? `Abonnement${resa.libelle ? ` — ${resa.libelle}` : ""}`
                : resa.type_blocage === "TOURNOI"
                  ? `Tournoi${resa.libelle ? ` — ${resa.libelle}` : ""}`
                  : MOTIF_LABEL[String(resa.motif || "")] || resa.motif || "Indisponible"}
            </p>
          ) : null}
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <span
            className="text-[11px] font-semibold px-2.5 py-1 rounded-full"
            style={{ background: badge.bg, color: badge.color }}
          >
            {badge.label}
          </span>
          {nuitPercu ? (
            <span
              className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
              style={{ background: "rgba(79,70,229,0.12)", color: "#4338ca" }}
            >
              ✦ {nuitPercu.labelComplet}
            </span>
          ) : null}
        </div>
      </div>

      {block === "en_attente" && (
        <div className="mt-2 space-y-2">
          <PaymentLockGauge
            expiresAt={Number(resa.verrou_expire_at)}
            startedAt={resa.created_at}
            onExpired={onRefresh}
          />
          <p className="text-xs" style={{ color: "var(--g-muted)" }}>
            {resa.joueur_nom ? `${resa.joueur_nom}` : "Joueur"}
          </p>
          {pendingCount > 1 ? (
            <button
              type="button"
              onClick={() => onOpenDetail(resa.id)}
              className="w-full min-h-[44px] rounded-xl text-sm font-semibold"
              style={{ color: "var(--g-en-attente)", border: "1px solid var(--g-en-attente)" }}
            >
              Gérer les {pendingCount} demandes
            </button>
          ) : (
            <>
              <EnAttentePaiementActions
                reservationId={resa.id}
                montantAvance={resa.montant_avance}
                features={features}
                variant="compact"
                onDone={onRefresh}
              />
              <button
                type="button"
                onClick={() => onOpenDetail(resa.id)}
                className="w-full min-h-[40px] rounded-xl text-xs font-semibold"
                style={{ color: "var(--g-muted)", border: "1px solid var(--g-border)" }}
              >
                Voir la fiche
              </button>
            </>
          )}
        </div>
      )}

      {(block === "imminente" || block === "en_cours" || block === "reserve") && (
        <div className="mt-2 flex items-start gap-2">
          <User className="w-3.5 h-3.5 mt-0.5 shrink-0" style={{ color: "var(--g-muted)" }} />
          <div>
            <p className="text-sm font-semibold" style={{ color: "var(--g-text)" }}>
              {resa.joueur_nom || "Joueur"}
            </p>
            {resa.joueur_telephone && (
              <p className="text-xs" style={{ color: "var(--g-muted)" }}>
                {resa.joueur_telephone}
              </p>
            )}
          </div>
        </div>
      )}

      {dejaScanne && (
        <div className="mt-2 space-y-1.5">
          <span
            className="inline-flex text-[11px] font-semibold px-2.5 py-1 rounded-full"
            style={{ background: "var(--g-libre-bg)", color: "var(--g-libre)" }}
          >
            {formatEntreeValidee(resa.qr_code_scanne_at)}
          </span>
          {block === "en_cours" && reste > 0 ? (
            <span
              className="inline-flex text-[11px] font-semibold px-2.5 py-1 rounded-full"
              style={{ background: "var(--g-en-cours-bg)", color: "var(--g-warning)" }}
            >
              💵 Encaisser {reste.toLocaleString("fr-FR")} FCFA sur place
            </span>
          ) : null}
          {block === "en_cours" && reste <= 0 ? (
            <span
              className="inline-flex text-[11px] font-semibold px-2.5 py-1 rounded-full"
              style={{ background: "var(--g-libre-bg)", color: "var(--g-libre)" }}
            >
              ✓ Aucun paiement sur place
            </span>
          ) : null}
        </div>
      )}

      {!dejaScanne && isImminente && reste > 0 && (
        <div className="mt-2">
          <span
            className="inline-flex text-[11px] font-semibold px-2.5 py-1 rounded-full"
            style={{ background: "var(--g-en-cours-bg)", color: "var(--g-warning)" }}
          >
            💵 Encaisser {reste.toLocaleString("fr-FR")} FCFA sur place
          </span>
        </div>
      )}

      <div className="mt-3">
        {block === "libre" && (
          <button
            type="button"
            onClick={() =>
              onExpress({
                date: dayDate,
                heure_debut: String(resa.heure_debut).slice(0, 5),
                heure_fin: String(resa.heure_fin).slice(0, 5),
              })
            }
            className="w-full min-h-[44px] rounded-xl text-sm font-semibold"
            style={{
              color: "var(--g-primary)",
              border: "1px solid var(--g-primary)",
            }}
          >
            Créer une réservation
          </button>
        )}
        {block === "bloque" && (
          <button
            type="button"
            onClick={() => onUnblock(resa.blocage_ids?.length ? resa.blocage_ids : resa.blocage_id)}
            className="w-full min-h-[44px] rounded-xl text-sm font-semibold"
            style={{
              color: "var(--g-danger)",
              border: "1px solid var(--g-danger)",
            }}
          >
            {kind === "abonnement" ? "Gérer l'abonnement" : kind === "tournoi" ? "Annuler le tournoi" : "Rendre disponible"}
          </button>
        )}
        {!dejaScanne && isImminente && canScanNow && (
          <button
            type="button"
            onClick={() => onScan(resa)}
            className="w-full h-11 rounded-xl text-sm font-semibold text-white animate-pulse"
            style={{ background: "var(--g-primary)" }}
          >
            📷 Valider l&apos;entrée — Scanner QR
          </button>
        )}
        {!dejaScanne && isImminente && !canScanNow && (
          <p className="text-xs mt-1" style={{ color: "var(--g-muted)" }}>
            Scanne d&apos;abord {prioriteHeure ? prioriteHeure.replace(":", "h") : "le créneau prioritaire"}
            {prioriteJoueur ? ` (${prioriteJoueur})` : ""} — un seul créneau à la fois
          </p>
        )}
        {block === "reserve" && (
          <button
            type="button"
            onClick={() => onOpenDetail(resa.id)}
            className="w-full min-h-[44px] rounded-xl text-sm font-semibold"
            style={{
              color: "var(--g-muted)",
              border: "1px solid var(--g-border)",
            }}
          >
            Voir le détail
          </button>
        )}
      </div>
    </li>
  );
}

const MOTIF_LABEL: Record<string, string> = {
  pluie: "Pluie",
  maintenance: "Maintenance",
  fermeture: "Fermeture",
  match_prive: "Match privé",
  autre: "Autre",
};

function QueueSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          className="h-[108px] animate-pulse rounded-2xl"
          style={{ background: "var(--g-surface-2)" }}
        />
      ))}
    </div>
  );
}

function formatJourHeader(ymd: string) {
  const d = new Date(`${ymd}T12:00:00`);
  const raw = d.toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

function hourKeysBetween(debut: string, fin: string) {
  const start = timeToMinutes(debut);
  let end = timeToMinutes(fin);
  if (end <= start) end += 24 * 60;
  const hours: string[] = [];
  for (let m = start; m < end; m += 60) {
    hours.push(`${String(Math.floor(m / 60) % 24).padStart(2, "0")}:00`);
  }
  return hours;
}

function blocageReasonKey(b: {
  groupe_id?: string | null;
  type_blocage?: string | null;
  libelle?: string | null;
  motif?: string | null;
}) {
  if (b.groupe_id) return `g:${b.groupe_id}`;
  return `r:${b.type_blocage || "MANUEL"}|${b.libelle || ""}|${b.motif || ""}`;
}

function mergeConsecutiveBlocages<
  T extends {
    id: number;
    heure_debut: string;
    heure_fin: string;
    groupe_id?: string | null;
    type_blocage?: string | null;
    libelle?: string | null;
    motif?: string | null;
  },
>(blocages: T[]) {
  const sorted = [...blocages].sort(
    (a, b) => timeToMinutes(String(a.heure_debut)) - timeToMinutes(String(b.heure_debut)),
  );
  const merged: Array<T & { blocage_ids: number[] }> = [];
  for (const b of sorted) {
    const last = merged[merged.length - 1];
    const sameReason = last && blocageReasonKey(last) === blocageReasonKey(b);
    const contiguous =
      last && String(last.heure_fin).slice(0, 5) === String(b.heure_debut).slice(0, 5);
    if (sameReason && contiguous) {
      last.heure_fin = b.heure_fin;
      last.blocage_ids.push(b.id);
    } else {
      merged.push({ ...b, blocage_ids: [b.id] });
    }
  }
  return merged;
}

function emptyQueueBlocks(): Record<QueueBlock, TodayReservation[]> {
  return {
    imminente: [],
    en_cours: [],
    libre: [],
    reserve: [],
    en_attente: [],
    termine: [],
    bloque: [],
  };
}

function buildQueueBlocks({
  reservations,
  dayDate,
  freeSlots,
  blocages,
  nowMs,
}: {
  reservations: TodayReservation[];
  dayDate: string;
  freeSlots: { heure_debut: string; heure_fin: string }[];
  blocages: Array<{
    id: number;
    date: string;
    heure_debut: string;
    heure_fin: string;
    motif?: string | null;
    type_blocage?: string | null;
    libelle?: string | null;
    groupe_id?: string | null;
  }>;
  nowMs: number;
}): Record<QueueBlock, TodayReservation[]> {
  const occupying = reservations.filter((r) => r.statut !== "en_attente");
  const pending = reservations.filter((r) => r.statut === "en_attente");
  const reservedHours = new Set(
    occupying
      .filter((r) => resolveLiveStatus(r, dayDate, nowMs) !== "termine")
      .flatMap((r) => hourKeysBetween(r.heure_debut, r.heure_fin)),
  );
  const mergedBlocages = mergeConsecutiveBlocages(blocages);
  // Blocages encore actifs uniquement (abonnement / tournoi / indispo) — passés exclus comme les libres
  const blocagesActifs = mergedBlocages.filter((b) => {
    const debut = String(b.heure_debut).slice(0, 5);
    const fin = String(b.heure_fin).slice(0, 5);
    const { heureFinMs } = calculerFenetreCheckIn({
      date: dayDate,
      heure_debut: debut,
      heure_fin: fin,
    });
    return nowMs <= heureFinMs;
  });
  const blockedHours = new Set(
    blocagesActifs.flatMap((b) => hourKeysBetween(b.heure_debut, b.heure_fin)),
  );
  const libresAsCards: TodayReservation[] = freeSlots
    .filter((s) => {
      const h = String(s.heure_debut).slice(0, 5);
      if (reservedHours.has(h) || blockedHours.has(h)) return false;
      return !isSlotInPast(dayDate, h, nowMs);
    })
    .map((s, idx) => ({
      id: -1000 - idx,
      heure_debut: s.heure_debut,
      heure_fin: s.heure_fin,
      statut: "libre",
      date: dayDate,
    }));
  const bloqueAsCards: TodayReservation[] = blocagesActifs.map((b) => ({
    id: -2000 - b.blocage_ids[0],
    blocage_id: b.blocage_ids[0],
    blocage_ids: b.blocage_ids,
    groupe_id: b.groupe_id,
    heure_debut: String(b.heure_debut).slice(0, 5),
    heure_fin: String(b.heure_fin).slice(0, 5),
    statut: "bloque",
    motif: b.motif,
    type_blocage: b.type_blocage,
    libelle: b.libelle,
    date: dayDate,
  }));
  const pendingBySlot = new Map<string, TodayReservation[]>();
  for (const r of pending) {
    const key = `${String(r.heure_debut).slice(0, 5)}-${String(r.heure_fin).slice(0, 5)}`;
    const group = pendingBySlot.get(key) || [];
    group.push(r);
    pendingBySlot.set(key, group);
  }
  const pendingCards: TodayReservation[] = [...pendingBySlot.values()].map((group) => ({
    ...group[0],
    pending_count: group.length,
    joueur_nom: group.length === 1 ? group[0].joueur_nom : `${group.length} joueurs`,
  }));

  const all = [...occupying, ...pendingCards, ...libresAsCards, ...bloqueAsCards];
  const byBlock = emptyQueueBlocks();
  for (const resa of all) {
    const block = resolveQueueBlock(resa, dayDate, nowMs);
    // Abonnement / tournoi / blocage passés : disparaître (pas dans « terminés »)
    if (
      block === "termine" &&
      (resa.statut === "bloque" || resa.statut === "blocked")
    ) {
      continue;
    }
    byBlock[block].push(resa);
  }
  (Object.keys(byBlock) as QueueBlock[]).forEach((key) => {
    byBlock[key].sort((a, b) => timeToMinutes(a.heure_debut) - timeToMinutes(b.heure_debut));
  });
  return byBlock;
}

type FileAttenteBlocksProps = {
  queueBlocks: Record<QueueBlock, TodayReservation[]>;
  dayDate: string;
  nowMs: number;
  emptyTitle: string;
  features?: Record<string, boolean> | null;
  onScan: (resa: TodayReservation) => void;
  onExpress: (prefill: { date?: string; heure_debut?: string; heure_fin?: string }) => void;
  onUnblock: (id?: number | number[]) => void;
  onOpenDetail: (id: number) => void;
  onRefresh?: () => void;
};

function FileAttenteBlocks({
  queueBlocks,
  dayDate,
  nowMs,
  emptyTitle,
  features,
  onScan,
  onExpress,
  onUnblock,
  onOpenDetail,
  onRefresh,
}: FileAttenteBlocksProps) {
  const [terminesOuverts, setTerminesOuverts] = useState(false);
  const isEmpty = Object.values(queueBlocks).every((arr) => arr.length === 0);

  if (isEmpty) {
    return (
      <div className="text-center py-10 px-4 rounded-2xl" style={{ background: "var(--g-surface)", boxShadow: "var(--g-shadow)" }}>
        <p className="text-4xl mb-3">😊</p>
        <p className="text-sm font-semibold" style={{ color: "var(--g-text)" }}>
          {emptyTitle}
        </p>
        <p className="text-xs mt-1" style={{ color: "var(--g-muted)" }}>
          Vérifie les horaires ou crée une réservation
        </p>
        <button
          type="button"
          onClick={() => onExpress({ date: dayDate })}
          className="mt-4 min-h-[44px] px-4 rounded-xl text-sm font-semibold"
          style={{
            color: "var(--g-primary)",
            border: "1px solid var(--g-primary)",
          }}
        >
          Réserver
        </button>
      </div>
    );
  }

  const prioriteScanId = idPrioriteScannable(
    queueBlocks.imminente.map((r) => ({
      id: r.id,
      date: dayDate,
      heure_debut: r.heure_debut,
      heure_fin: r.heure_fin,
      fenetre_retard: r.fenetre_retard,
      statut: r.statut,
      qr_code_scanne_at: r.qr_code_scanne_at,
      joueur_nom: r.joueur_nom,
      code_reservation: r.code_reservation,
    })),
    nowMs,
  );
  const prioriteResa = queueBlocks.imminente.find((r) => Number(r.id) === Number(prioriteScanId)) || null;

  const cardProps = {
    dayDate,
    nowMs,
    features,
    onScan,
    onExpress,
    onUnblock,
    onOpenDetail,
    onRefresh,
    prioriteHeure: prioriteResa?.heure_debut ? String(prioriteResa.heure_debut).slice(0, 5) : null,
    prioriteJoueur: prioriteResa?.joueur_nom || null,
  };

  // File chronologique unique : libres + blocages (abo/tournoi/indispo) + réservés + en attente
  const fileChrono = trierCreneaux([
    ...queueBlocks.libre,
    ...queueBlocks.bloque,
    ...queueBlocks.reserve,
    ...queueBlocks.en_attente,
  ]);

  return (
    <div className="space-y-5">
      {([
        { key: "imminente" as const, items: queueBlocks.imminente },
        { key: "en_cours" as const, items: queueBlocks.en_cours },
        { key: "file" as const, items: fileChrono },
      ]).map(({ key, items }) =>
        items.length === 0 ? null : (
          <ul key={key} className="space-y-3">
            {trierCreneaux(items).map((resa, idx, arr) => {
              const isNuit = estNuitProlongee(resa.heure_debut);
              const prevNuit = idx > 0 && estNuitProlongee(arr[idx - 1].heure_debut);
              const showSep = isNuit && !prevNuit;
              const nuitLabel = isNuit
                ? getJourPercu(String(resa.date || dayDate).slice(0, 10), String(resa.heure_debut).slice(0, 5))
                    .labelComplet
                : null;
              return (
                <Fragment key={`${resa.id}-${resa.heure_debut}`}>
                  {showSep ? (
                    <li className="list-none py-1">
                      <p
                        className="text-center text-[11px] font-medium"
                        style={{ color: "#6366f1" }}
                      >
                        ── ✦ Après minuit ({nuitLabel?.toLowerCase() || "nuit prolongée"}) ──
                      </p>
                    </li>
                  ) : null}
                  <QueueCard
                    resa={resa}
                    canScanNow={Boolean(prioriteScanId) && Number(resa.id) === Number(prioriteScanId)}
                    {...cardProps}
                  />
                </Fragment>
              );
            })}
          </ul>
        ),
      )}

      {queueBlocks.termine.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setTerminesOuverts((v) => !v)}
            className="w-full min-h-[44px] rounded-xl text-sm font-semibold"
            style={{
              background: "var(--g-surface-2)",
              color: "var(--g-muted)",
            }}
          >
            {terminesOuverts
              ? "Masquer les matchs terminés"
              : `Voir les ${queueBlocks.termine.length} match${queueBlocks.termine.length > 1 ? "s" : ""} terminé${queueBlocks.termine.length > 1 ? "s" : ""}`}
          </button>
          {terminesOuverts ? (
            <ul className="mt-3 space-y-3">
              {queueBlocks.termine.map((resa) => (
                <QueueCard
                  key={`${resa.id}-${resa.heure_debut}`}
                  resa={resa}
                  canScanNow={false}
                  {...cardProps}
                />
              ))}
            </ul>
          ) : null}
        </div>
      )}
    </div>
  );
}

const ManagerDashboard = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, isAuthenticated } = useAuth();
  const isGerant = isAuthenticated && normalizeRole(user) === "gerant";

  const {
    dashboard,
    isInitialLoading: dashInitial,
    isRefetching: dashRefetching,
    refetch: refetchDashboard,
  } = useGerantDashboard(isGerant);

  const [selectedDay, setSelectedDay] = useState(localYmd());
  const {
    todayPayload,
    isInitialLoading: todayInitial,
    isRefetching: todayRefetching,
    refetch: refetchToday,
  } = useGerantToday(undefined, isGerant);

  const [vueActive, setVueActive] = useState<"aujourd_hui" | "semaine">("aujourd_hui");
  const {
    weekReservations,
    isInitialLoading: weekInitial,
    isRefetching: weekRefetching,
    refetch: refetchWeek,
  } = useGerantWeek(isGerant && vueActive === "semaine");

  const { silentRefetch, patchTodayReservation, removeBlocagesOptimistic, restoreDashboard, queryClient } =
    useGerantLiveInvalidate();

  const [autresGerantsActifs, setAutresGerantsActifs] = useState<
    Array<{ gerant_id: number; prenom?: string; nom?: string }>
  >([]);
  const [filtreJourSemaine, setFiltreJourSemaine] = useState<string>("tous");
  const [expressOpen, setExpressOpen] = useState(false);
  const [expressPrefill, setExpressPrefill] = useState<{
    date?: string;
    heure_debut?: string;
    heure_fin?: string;
  } | null>(null);
  const [blockOpen, setBlockOpen] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scanTarget, setScanTarget] = useState<TodayReservation | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  /** Horloge locale pour recalculer les flags sans attendre un refresh API. */
  const [nowMs, setNowMs] = useState(() => Date.now());

  const [freeSlots, setFreeSlots] = useState<
    { heure_debut: string; heure_fin: string; disponible?: boolean }[]
  >([]);

  const isInitialLoading = dashInitial && !dashboard;
  const isSyncing = dashRefetching || todayRefetching || (vueActive === "semaine" && weekRefetching);
  /** Première ouverture de la vue semaine sans cache : mini skeleton local, pas un reload page. */
  const weekNeedsFirstPaint = vueActive === "semaine" && weekInitial && weekReservations.length === 0;

  const refreshLive = useCallback(() => {
    void refetchDashboard();
    void refetchToday();
    if (vueActive === "semaine") void refetchWeek();
  }, [refetchDashboard, refetchToday, refetchWeek, vueActive]);

  const loadFreeSlots = useCallback(async (terrainId?: number, date?: string) => {
    if (!terrainId || !date) {
      setFreeSlots([]);
      return;
    }
    setFreeSlots([]); // évite d'afficher les créneaux libres d'un autre jour pendant le fetch
    try {
      // Endpoint gérant : journée complète (le filtre « passé » se fait dans buildQueueBlocks)
      const data = (await gerantApi.disponibilites(date)) as {
        creneaux?: { heure?: string; heure_debut?: string; heure_fin?: string; disponible?: boolean; statut?: string }[];
      };
      const libres = (data?.creneaux || [])
        .filter((c) => c.disponible !== false && c.statut !== "occupe" && c.statut !== "bloque" && c.statut !== "reserve")
        .map((c) => {
          const debut = String(c.heure_debut || c.heure || "").slice(0, 5);
          const fin = String(c.heure_fin || "").slice(0, 5) || (() => {
            const h = parseInt(debut.split(":")[0], 10);
            return `${String(h + 1).padStart(2, "0")}:00`;
          })();
          return { heure_debut: debut, heure_fin: fin, disponible: true };
        })
        .filter((c) => c.heure_debut);
      setFreeSlots(libres);
    } catch {
      setFreeSlots([]);
    }
  }, []);

  const basculerVue = (vue: "aujourd_hui" | "semaine") => {
    if (vue === vueActive) return;
    setVueActive(vue);
    if (vue === "semaine") {
      setFiltreJourSemaine("tous");
      void refetchWeek();
    } else {
      void refetchToday();
    }
  };

  useEffect(() => {
    if (!isAuthenticated || normalizeRole(user) !== "gerant") {
      navigate("/backoffice/login");
    }
  }, [isAuthenticated, user, navigate]);

  useEffect(() => {
    if (todayPayload?.date) setSelectedDay(todayPayload.date);
  }, [todayPayload?.date]);

  // Rechargement silencieux quand le terrain actif change
  useEffect(() => {
    const onTerrain = () => {
      void silentRefetch();
    };
    window.addEventListener("gerant-terrain-changed", onTerrain);
    return () => window.removeEventListener("gerant-terrain-changed", onTerrain);
  }, [silentRefetch]);

  // Indicateur gérants en ligne (via heartbeat)
  useEffect(() => {
    if (!isGerant) return;
    const tick = async () => {
      try {
        const res = await gerantApi.heartbeat();
        setAutresGerantsActifs(Array.isArray(res?.autres_gerants) ? res.autres_gerants : []);
      } catch {
        /* ignore */
      }
    };
    tick();
    const timer = window.setInterval(tick, 30000);
    return () => window.clearInterval(timer);
  }, [isGerant]);

  // Horloge locale 60s (flags UI) — le refetch données est géré par React Query
  useEffect(() => {
    if (!isGerant) return;
    const timer = window.setInterval(() => setNowMs(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, [isGerant]);

  useEffect(() => {
    const terrainId = dashboard?.terrain?.id;
    if (vueActive === "semaine" && filtreJourSemaine !== "tous" && terrainId) {
      void loadFreeSlots(terrainId, filtreJourSemaine);
      return;
    }
    const date = todayPayload?.date || selectedDay;
    if (terrainId && date) void loadFreeSlots(terrainId, date);
  }, [dashboard?.terrain?.id, todayPayload?.date, selectedDay, vueActive, filtreJourSemaine, loadFreeSlots]);

  useTerrainEvents(dashboard?.terrain?.id, () => {
    refreshLive();
  });

  const todayList = (todayPayload?.reservations || []) as TodayReservation[];
  const dayDate = todayPayload?.date || selectedDay || localYmd();

  const allBlocages = useMemo(() => {
    return ((dashboard?.blocages || []) as Array<{
      id: number;
      date: string;
      heure_debut: string;
      heure_fin: string;
      motif?: string | null;
      type_blocage?: string | null;
      libelle?: string | null;
      groupe_id?: string | null;
    }>);
  }, [dashboard?.blocages]);

  const dayBlocages = useMemo(() => {
    return allBlocages.filter((b) => String(b.date).slice(0, 10) === dayDate);
  }, [allBlocages, dayDate]);

  /** File d'attente découpée en blocs métier (haut → bas). */
  const queueBlocks = useMemo(
    () =>
      buildQueueBlocks({
        reservations: todayList,
        dayDate,
        freeSlots,
        blocages: dayBlocages,
        nowMs,
      }),
    [todayList, freeSlots, dayDate, dayBlocages, nowMs],
  );

  const parJour = useMemo(() => {
    const acc: Record<string, TodayReservation[]> = {};
    const addDays = (ymd: string, delta: number) => {
      const d = new Date(`${ymd}T12:00:00`);
      d.setDate(d.getDate() + delta);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      return `${y}-${m}-${day}`;
    };
    for (const r of weekReservations as TodayReservation[]) {
      const dateTech = String(r.date || "").slice(0, 10);
      if (!dateTech) continue;
      // Nuit prolongée → jour perçu (veille)
      const datePercue = estNuitProlongee(r.heure_debut) ? addDays(dateTech, -1) : dateTech;
      if (!acc[datePercue]) acc[datePercue] = [];
      acc[datePercue].push(r);
    }
    return Object.keys(acc)
      .sort()
      .map((date) => ({
        date,
        reservations: trierCreneaux(acc[date]),
      }));
  }, [weekReservations]);

  const joursSemaine = useMemo(() => weekDates(dayDate), [dayDate]);
  const joursAffiches = useMemo(() => {
    if (filtreJourSemaine === "tous") return parJour;
    const existing = parJour.find((j) => j.date === filtreJourSemaine);
    return [{ date: filtreJourSemaine, reservations: existing?.reservations || [] }];
  }, [parJour, filtreJourSemaine]);

  /** Réservations confirmées imminentes — bouton scanner header (seul le plus prioritaire) */
  const imminentes = queueBlocks.imminente;
  const prioriteScanIdHeader = idPrioriteScannable(
    imminentes.map((r) => ({
      id: r.id,
      date: dayDate,
      heure_debut: r.heure_debut,
      heure_fin: r.heure_fin,
      fenetre_retard: r.fenetre_retard,
      statut: r.statut,
      qr_code_scanne_at: r.qr_code_scanne_at,
      joueur_nom: r.joueur_nom,
      code_reservation: r.code_reservation,
    })),
    nowMs,
  );
  const prochaineImminente =
    imminentes.find((r) => Number(r.id) === Number(prioriteScanIdHeader)) || imminentes[0] || null;

  const stats = useMemo(() => {
    const aEncaisser = todayList.reduce((sum, r) => {
      const reste = Number(r.montant_restant ?? 0);
      if (reste > 0 && ["confirme", "acceptee"].includes(r.statut)) {
        return sum + reste;
      }
      return sum;
    }, 0);
    return {
      matchs: todayList.filter((r) => r.statut !== "en_attente").length,
      aEncaisser,
      libres: queueBlocks.libre.length,
    };
  }, [todayList, queueBlocks.libre.length]);

  /** Bouton actions rapides : pré-sélectionne la plus proche, sinon Mode A (QR seul). */
  const openScannerQuick = () => {
    setScanTarget(prochaineImminente);
    setScannerOpen(true);
  };

  /** Deep-link push / SW : /backoffice/gerant#scanner */
  useEffect(() => {
    if (isInitialLoading) return;
    if (location.hash !== "#scanner") return;
    setScanTarget(prochaineImminente);
    setScannerOpen(true);
    navigate({ pathname: location.pathname, search: location.search, hash: "" }, { replace: true });
  }, [isInitialLoading, location.hash, location.pathname, location.search, navigate, prochaineImminente]);

  /** Depuis une card : Mode B avec réservation connue. */
  const openScanner = (resa: TodayReservation) => {
    setScanTarget(resa);
    setScannerOpen(true);
  };

  const openExpress = (prefill?: { date?: string; heure_debut?: string; heure_fin?: string } | null) => {
    setExpressPrefill(prefill || null);
    setExpressOpen(true);
  };

  /** Optimistic UI — 0 ms : la carte bascule avant la réponse serveur. */
  const applyOptimisticScan = (reservation: {
    id?: number;
    joueur_nom?: string;
    qr_code_scanne_at?: string;
    montant_restant?: number;
    heure_debut?: string;
    heure_fin?: string;
  }) => {
    const id = Number(reservation?.id);
    if (!Number.isFinite(id) || id < 1) return;
    patchTodayReservation(
      id,
      {
        statut: "match_joue",
        qr_code_scanne_at: reservation.qr_code_scanne_at || new Date().toISOString(),
        joueur_nom: reservation.joueur_nom,
        montant_restant:
          reservation.montant_restant != null
            ? Number(reservation.montant_restant)
            : undefined,
      },
      todayPayload?.date,
    );
  };

  const handleUnblockCreneau = async (blocageId?: number | number[]) => {
    const ids = (Array.isArray(blocageId) ? blocageId : [blocageId]).filter(
      (id): id is number => typeof id === "number" && id > 0,
    );
    if (!ids.length) return;
    const snapshot = queryClient.getQueryData(["gerant", "live", "dashboard"]);
    removeBlocagesOptimistic(ids);
    try {
      if (ids.length === 1) {
        await gerantApi.removeBlocage(ids[0]);
      } else {
        await gerantApi.removeBlocages(ids);
      }
      toast.success(ids.length > 1 ? `${ids.length} créneaux débloqués` : "Créneau débloqué");
      void refetchDashboard();
      await loadFreeSlots(dashboard?.terrain?.id, dayDate);
      if (vueActive === "semaine") void refetchWeek();
    } catch (err: any) {
      restoreDashboard(snapshot);
      toast.error(err?.message || "Déblocage impossible");
    }
  };

  if (isInitialLoading) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="grid grid-cols-3 gap-2.5">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-[52px] rounded-2xl" style={{ background: "var(--g-surface-2)" }} />
          ))}
        </div>
        <div className="grid grid-cols-3 gap-2.5">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-24 rounded-2xl" style={{ background: "var(--g-surface-2)" }} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <SilentSyncDot active={isSyncing} label="Synchronisation file d'attente" />
      {autresGerantsActifs.length > 0 ? (
        <div
          className="flex items-center gap-2 px-4 py-2 rounded-lg"
          style={{ background: "var(--g-info-bg, color-mix(in srgb, var(--g-info) 12%, transparent))" }}
        >
          <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse shrink-0" />
          <span className="text-xs" style={{ color: "var(--g-info)" }}>
            {autresGerantsActifs.map((g) => g.prenom || g.nom || "Un gérant").join(" et ")}
            {autresGerantsActifs.length === 1 ? " est" : " sont"} aussi connecté(s)
          </span>
        </div>
      ) : null}

      {/* ACTIONS RAPIDES */}
      <div className="grid grid-cols-3 gap-2.5">
        <button
          type="button"
          onClick={() => openExpress(null)}
          className="h-[52px] rounded-xl text-white text-xs font-semibold inline-flex flex-col items-center justify-center gap-0.5 btn-press"
          style={{ background: "var(--g-primary)" }}
        >
          <PlusCircle className="w-5 h-5" />
          Réserver
        </button>
        <button
          type="button"
          onClick={openScannerQuick}
          className={`relative h-[52px] rounded-xl text-xs font-semibold inline-flex flex-col items-center justify-center gap-0.5 btn-press ${
            imminentes.length > 0 ? "animate-pulse" : ""
          }`}
          style={{
            background: imminentes.length > 0 ? "var(--g-primary)" : "var(--g-surface-2)",
            color: imminentes.length > 0 ? "#fff" : "var(--g-muted)",
            boxShadow: imminentes.length > 0 ? "0 0 0 2px var(--g-primary-glow)" : undefined,
          }}
          aria-label={
            imminentes.length > 0
              ? `Scanner — ${imminentes.length} match${imminentes.length > 1 ? "s" : ""} imminent${imminentes.length > 1 ? "s" : ""}`
              : "Scanner"
          }
        >
          <QrCode className={`w-5 h-5 ${imminentes.length > 0 ? "animate-pulse" : ""}`} />
          {imminentes.length > 0 ? `Scanner ⚡ (${imminentes.length})` : "Scanner"}
        </button>
        <button
          type="button"
          onClick={() => setBlockOpen(true)}
          className="h-[52px] rounded-xl text-xs font-semibold inline-flex flex-col items-center justify-center gap-0.5 btn-press"
          style={{ background: "var(--g-surface-2)", color: "var(--g-text)" }}
        >
          <CalendarCog className="w-5 h-5" />
          Événements
        </button>
      </div>

      {/* KPI */}
      <div className="grid grid-cols-3 gap-2.5">
        {[
          {
            value: String(stats.matchs),
            label: "matchs prévus",
            icon: CalendarDays,
            color: "var(--g-primary)",
            valueColor: "var(--g-text)",
          },
          {
            value: stats.aEncaisser.toLocaleString("fr-FR"),
            label: "à encaisser",
            icon: Banknote,
            color: "var(--g-warning)",
            valueColor: "var(--g-warning)",
          },
          {
            value: String(stats.libres),
            label: "créneaux libres",
            icon: Clock,
            color: "var(--g-libre)",
            valueColor: "var(--g-libre)",
          },
        ].map((card) => (
          <div
            key={card.label}
            className="rounded-2xl p-3 relative"
            style={{ background: "var(--g-surface)", boxShadow: "var(--g-shadow)" }}
          >
            <card.icon className="w-5 h-5 absolute top-3 right-3" style={{ color: card.color }} />
            <p
              className="text-2xl font-bold leading-none pr-6"
              style={{ fontFamily: "var(--font-display)", color: card.valueColor }}
            >
              {card.value}
            </p>
            <p className="text-[11px] mt-2" style={{ color: "var(--g-muted)" }}>
              {card.label}
            </p>
          </div>
        ))}
      </div>

      {/* TOGGLE */}
      <div className="flex gap-2">
        {(
          [
            { id: "aujourd_hui" as const, label: "Aujourd'hui" },
            { id: "semaine" as const, label: "Cette semaine" },
          ] as const
        ).map((t) => {
          const actif = vueActive === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => void basculerVue(t.id)}
              className="flex-1 min-h-[44px] rounded-full text-sm font-semibold"
              style={{
                background: actif ? "var(--g-primary)" : "var(--g-surface-2)",
                color: actif ? "#fff" : "var(--g-muted)",
              }}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {vueActive === "semaine" ? (
        <div className="flex gap-2 overflow-x-auto pb-1">
          <button
            type="button"
            onClick={() => setFiltreJourSemaine("tous")}
            className="shrink-0 min-h-[44px] px-3 rounded-full text-xs font-semibold"
            style={{
              background: filtreJourSemaine === "tous" ? "var(--g-primary)" : "var(--g-surface-2)",
              color: filtreJourSemaine === "tous" ? "#fff" : "var(--g-muted)",
            }}
          >
            Tous
          </button>
          {joursSemaine.map((ymd) => {
            const meta = formatJourCourt(ymd);
            const actif = filtreJourSemaine === ymd;
            const isToday = ymd === localYmd();
            return (
              <button
                key={ymd}
                type="button"
                onClick={() => setFiltreJourSemaine(ymd)}
                className="shrink-0 min-h-[44px] px-3 rounded-full text-xs font-semibold"
                style={{
                  background: actif ? "var(--g-primary)" : "var(--g-surface-2)",
                  color: actif ? "#fff" : "var(--g-text-2)",
                }}
              >
                {meta.label} {meta.day}
                {isToday && !actif ? " ·" : ""}
              </button>
            );
          })}
        </div>
      ) : null}

      {/* FILE D'ATTENTE */}
      <section>
        <h2 className="text-sm font-semibold mb-3" style={{ color: "var(--g-text)" }}>
          {vueActive === "semaine" ? "File d'attente de la semaine" : "File d'attente du jour"}
        </h2>

        {weekNeedsFirstPaint ? (
          <QueueSkeleton />
        ) : vueActive === "semaine" ? (
          joursAffiches.length === 0 ? (
            <FileAttenteBlocks
              queueBlocks={emptyQueueBlocks()}
              dayDate={dayDate}
              nowMs={nowMs}
              emptyTitle="Aucun match cette semaine"
              features={dashboard?.features || null}
              onScan={openScanner}
              onExpress={openExpress}
              onUnblock={(id) => void handleUnblockCreneau(id)}
              onOpenDetail={(id) => navigate(`/backoffice/gerant/reservations/${id}`)}
              onRefresh={() => {
                refreshLive();
              }}
            />
          ) : (
            <div className="space-y-8">
              {joursAffiches.map((jour) => {
                const blocsJour = buildQueueBlocks({
                  reservations: jour.reservations,
                  dayDate: jour.date,
                  freeSlots: jour.date === (filtreJourSemaine === "tous" ? dayDate : filtreJourSemaine) ? freeSlots : [],
                  blocages: allBlocages.filter((b) => String(b.date).slice(0, 10) === jour.date),
                  nowMs,
                });
                return (
                  <div key={jour.date}>
                    {filtreJourSemaine === "tous" ? (
                      <h3
                        className="text-sm font-bold mb-3 capitalize"
                        style={{ color: "var(--g-text)" }}
                      >
                        {formatJourHeader(jour.date)}
                      </h3>
                    ) : null}
                    <FileAttenteBlocks
                      queueBlocks={blocsJour}
                      dayDate={jour.date}
                      nowMs={nowMs}
                      emptyTitle={`Aucun match le ${formatJourHeader(jour.date)}`}
                      features={dashboard?.features || null}
                      onScan={openScanner}
                      onExpress={openExpress}
                      onUnblock={(id) => void handleUnblockCreneau(id)}
                      onOpenDetail={(id) => navigate(`/backoffice/gerant/reservations/${id}`)}
                      onRefresh={() => {
                        refreshLive();
                      }}
                    />
                  </div>
                );
              })}
            </div>
          )
        ) : (
          <FileAttenteBlocks
            queueBlocks={queueBlocks}
            dayDate={dayDate}
            nowMs={nowMs}
            emptyTitle="Aucun créneau aujourd'hui"
            features={dashboard?.features || null}
            onScan={openScanner}
            onExpress={openExpress}
            onUnblock={(id) => void handleUnblockCreneau(id)}
            onOpenDetail={(id) => navigate(`/backoffice/gerant/reservations/${id}`)}
            onRefresh={() => {
              refreshLive();
            }}
          />
        )}
      </section>

      <ReservationExpressModal
        open={expressOpen}
        onClose={() => setExpressOpen(false)}
        terrainId={dashboard?.terrain?.id}
        prefill={expressPrefill}
        onCreated={() => {
          refreshLive();
          void loadFreeSlots(dashboard?.terrain?.id, dayDate);
        }}
      />

      <BloquerCreneauModal
        open={blockOpen}
        onClose={() => setBlockOpen(false)}
        terrainId={dashboard?.terrain?.id}
        blocages={dashboard?.blocages || []}
        features={dashboard?.features || null}
        onChanged={() => {
          refreshLive();
          void loadFreeSlots(dashboard?.terrain?.id, dayDate);
        }}
      />

      <ScannerModal
        open={scannerOpen}
        onClose={() => {
          setScannerOpen(false);
          setScanTarget(null);
        }}
        expectedReservationId={scanTarget?.id ?? null}
        expectedCodeReservation={scanTarget?.code_reservation ?? null}
        onSuccess={(reservation) => {
          applyOptimisticScan(reservation);
          setScannerOpen(false);
          setScanTarget(null);
        }}
        onManualValidation={() => {
          setScannerOpen(false);
          setScanTarget(null);
          setManualOpen(true);
        }}
      />

      <ValidationManuelleModal
        open={manualOpen}
        onClose={() => setManualOpen(false)}
        reservations={todayList}
        onSuccess={(reservation) => {
          if (reservation) applyOptimisticScan(reservation);
          setManualOpen(false);
        }}
      />
    </div>
  );
};

export default ManagerDashboard;
