import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Clock3, Info, Search, X, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { gerantApi } from "@/lib/api";

export type ManualReservation = {
  id: number;
  code_reservation?: string | null;
  joueur_nom?: string | null;
  joueur_telephone?: string | null;
  heure_debut: string;
  heure_fin?: string;
  statut: string;
  qr_code_scanne_at?: string | null;
  terrain_id?: number | null;
  creneau_id?: number | null;
  montant_restant?: number;
};

type ResultState =
  | "idle"
  | "success"
  | "too_early"
  | "expired"
  | "already_scanned"
  | "invalid"
  | "wrong_terrain";

type ScanResult = {
  state: ResultState;
  title?: string;
  text?: string;
  minutesRemaining?: number;
  reservation?: {
    joueur_nom?: string;
    heure_debut?: string;
    heure_fin?: string;
    montant_restant?: number;
    qr_code_scanne_at?: string;
  };
};

type Props = {
  open: boolean;
  onClose: () => void;
  reservations: ManualReservation[];
  /** Depuis la fiche détail : pré-sélectionne cette résa */
  preselectedId?: number | null;
  onSuccess?: (reservation?: {
    id?: number;
    joueur_nom?: string;
    heure_debut?: string;
    heure_fin?: string;
    montant_restant?: number;
    qr_code_scanne_at?: string;
  }) => void;
};

const STATUS_LABEL: Record<string, string> = {
  confirme: "Confirmé",
  acceptee: "Acceptée",
  en_attente: "En attente",
  match_joue: "Terminé",
  joue: "Terminé",
  annule: "Annulée",
};

function formatTime(value?: string) {
  if (!value) return "-";
  return String(value).slice(0, 5).replace(":", "h");
}

function formatDateTime(value?: string) {
  if (!value) return "-";
  const raw = String(value).trim();
  const date = new Date(raw.includes("T") ? raw : raw.replace(" ", "T"));
  if (Number.isNaN(date.getTime())) return raw;
  return date.toLocaleString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatMoney(value?: number) {
  return Number(value || 0).toLocaleString("fr-FR");
}

function normalizeQuery(value: string) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\s.\-()]/g, "");
}

function buildManualQrPayload(resa: ManualReservation): string {
  return JSON.stringify({
    reservation_id: resa.id,
    code: String(resa.code_reservation || "").toUpperCase(),
    creneau_id: resa.creneau_id ?? null,
    terrain_id: resa.terrain_id ?? null,
  });
}

export default function ValidationManuelleModal({
  open,
  onClose,
  reservations,
  preselectedId = null,
  onSuccess,
}: Props) {
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ScanResult>({ state: "idle" });

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setBusy(false);
    setResult({ state: "idle" });
    setSelectedId(preselectedId ?? null);
  }, [open, preselectedId]);

  const filtered = useMemo(() => {
    const q = normalizeQuery(query);
    const list = [...reservations].sort((a, b) =>
      String(a.heure_debut).localeCompare(String(b.heure_debut)),
    );
    if (!q) return list;
    return list.filter((r) => {
      const nom = normalizeQuery(r.joueur_nom || "");
      const tel = normalizeQuery(r.joueur_telephone || "");
      const code = normalizeQuery(r.code_reservation || "");
      return nom.includes(q) || tel.includes(q) || code.includes(q);
    });
  }, [reservations, query]);

  const selected = useMemo(
    () => reservations.find((r) => r.id === selectedId) || null,
    [reservations, selectedId],
  );

  if (!open) return null;

  const handleValidate = async () => {
    if (!selected) return;
    if (!selected.code_reservation) {
      setResult({
        state: "invalid",
        title: "❌ Impossible de valider",
        text: "Cette réservation n'a pas de code QR. Demande au joueur de montrer le QR WhatsApp ou régénère le code.",
      });
      return;
    }

    setBusy(true);
    try {
      const payload = (await gerantApi.scanQr(
        selected.id,
        "especes",
        buildManualQrPayload(selected),
      )) as { reservation?: ScanResult["reservation"] };

      setResult({
        state: "success",
        title: "✅ Entrée validée !",
        reservation: payload.reservation,
      });
      onSuccess?.(payload.reservation);
    } catch (err) {
      const error = err as Error & {
        code?: string;
        status?: number;
        scannable_at?: string;
        minutes_remaining?: number;
        match_time?: string;
        qr_code_scanne_at?: string;
      };

      if (error.code === "QR_SCAN_TOO_EARLY") {
        setResult({
          state: "too_early",
          title: "⏰ C'est un peu tôt",
          text: error.scannable_at
            ? `Tu pourras valider à partir de ${new Date(error.scannable_at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}.`
            : error.message,
          minutesRemaining: error.minutes_remaining,
        });
      } else if (error.code === "QR_SCAN_EXPIRED") {
        setResult({
          state: "expired",
          title: "⌛ Fenêtre dépassée",
          text: `Ce match était prévu à ${formatTime(error.match_time)}. Le délai de validation est dépassé.`,
        });
      } else if (error.code === "QR_ALREADY_SCANNED" || error.status === 403) {
        setResult({
          state: "already_scanned",
          title: "ℹ️ Ce joueur est déjà entré",
          text: `QR validé le ${formatDateTime(error.qr_code_scanne_at)}`,
        });
      } else if (error.code === "QR_WRONG_TERRAIN") {
        setResult({
          state: "wrong_terrain",
          title: "❌ Ce QR code ne correspond pas à ton terrain",
          text: error.message,
        });
      } else {
        setResult({
          state: "invalid",
          title: "❌ Validation refusée",
          text: error.message || "Impossible de valider cette entrée.",
        });
      }
    } finally {
      setBusy(false);
    }
  };

  const reste = Number(result.reservation?.montant_restant ?? 0);

  return (
    <div className="fixed inset-0 z-[85] flex flex-col justify-end bg-black/45" role="dialog" aria-modal="true">
      <button type="button" className="absolute inset-0 cursor-default" aria-label="Fermer" onClick={onClose} />

      <div
        className="relative z-10 max-h-[88vh] overflow-hidden rounded-t-2xl bg-white shadow-xl flex flex-col"
        style={{ color: "var(--g-text)" }}
      >
        <div className="flex items-center justify-between px-4 pt-4 pb-2 border-b" style={{ borderColor: "var(--g-border)" }}>
          <div>
            <h2 className="text-base font-bold">Validation manuelle</h2>
            <p className="text-xs" style={{ color: "var(--g-muted)" }}>
              Joueur sans batterie ou QR illisible
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="h-10 w-10 rounded-full inline-flex items-center justify-center"
            style={{ background: "var(--g-surface-2)" }}
            aria-label="Fermer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {result.state === "idle" ? (
          <>
            <div className="px-4 pt-3 pb-2">
              <div
                className="flex items-center gap-2 rounded-xl px-3 h-11 border"
                style={{ borderColor: "var(--g-border)", background: "var(--g-surface-2)" }}
              >
                <Search className="w-4 h-4 shrink-0" style={{ color: "var(--g-muted)" }} />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Nom ou téléphone du joueur…"
                  className="flex-1 bg-transparent outline-none text-sm"
                  autoFocus={!preselectedId}
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-4 pb-3 space-y-2 min-h-[200px]">
              {filtered.length === 0 ? (
                <p className="text-sm text-center py-8" style={{ color: "var(--g-muted)" }}>
                  Aucune réservation du jour ne correspond.
                </p>
              ) : (
                filtered.map((r) => {
                  const active = selectedId === r.id;
                  const already = Boolean(r.qr_code_scanne_at) || ["match_joue", "joue"].includes(r.statut);
                  return (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => setSelectedId(r.id)}
                      className="w-full text-left rounded-xl border px-3 py-3 transition-colors"
                      style={{
                        borderColor: active ? "var(--g-primary)" : "var(--g-border)",
                        background: active ? "var(--g-primary-glow)" : "white",
                      }}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold truncate">{r.joueur_nom || "Joueur inconnu"}</p>
                          <p className="text-xs mt-0.5" style={{ color: "var(--g-muted)" }}>
                            {formatTime(r.heure_debut)}
                            {r.heure_fin ? ` → ${formatTime(r.heure_fin)}` : ""}
                            {r.joueur_telephone ? ` · ${r.joueur_telephone}` : ""}
                          </p>
                        </div>
                        <span
                          className="shrink-0 text-[11px] font-semibold px-2 py-0.5 rounded-full"
                          style={{
                            background: already ? "var(--g-termine-bg)" : "var(--g-reserve-bg)",
                            color: already ? "var(--g-termine)" : "var(--g-reserve)",
                          }}
                        >
                          {STATUS_LABEL[r.statut] || r.statut}
                        </span>
                      </div>
                    </button>
                  );
                })
              )}
            </div>

            <div className="px-4 pb-5 pt-2 border-t space-y-2" style={{ borderColor: "var(--g-border)" }}>
              {selected ? (
                <p className="text-xs text-center" style={{ color: "var(--g-muted)" }}>
                  Sélection : <strong style={{ color: "var(--g-text)" }}>{selected.joueur_nom || `#${selected.id}`}</strong>
                  {" · "}
                  {formatTime(selected.heure_debut)}
                </p>
              ) : null}
              <Button
                type="button"
                variant="hero"
                className="w-full min-h-[48px]"
                disabled={!selected || busy}
                onClick={() => void handleValidate()}
              >
                {busy ? "Validation…" : "Valider l'entrée manuellement"}
              </Button>
            </div>
          </>
        ) : (
          <div className="px-5 py-8 text-center space-y-4">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full"
              style={{
                background:
                  result.state === "success"
                    ? "color-mix(in srgb, var(--color-success) 14%, white)"
                    : result.state === "too_early"
                      ? "color-mix(in srgb, var(--color-warning) 14%, white)"
                      : result.state === "already_scanned"
                        ? "color-mix(in srgb, var(--color-info) 14%, white)"
                        : "color-mix(in srgb, var(--color-danger) 12%, white)",
              }}
            >
              {result.state === "success" && <CheckCircle2 className="h-8 w-8 text-[var(--color-success)]" />}
              {result.state === "too_early" && <Clock3 className="h-8 w-8 text-[var(--color-warning)]" />}
              {result.state === "already_scanned" && <Info className="h-8 w-8 text-[var(--color-info)]" />}
              {(result.state === "expired" || result.state === "invalid" || result.state === "wrong_terrain") && (
                <XCircle className="h-8 w-8 text-[var(--color-danger)]" />
              )}
            </div>

            <h3 className="text-xl font-bold" style={{ fontFamily: "var(--font-display)" }}>
              {result.title}
            </h3>

            {result.state === "success" && result.reservation && (
              <div className="space-y-2">
                <p className="font-bold">{result.reservation.joueur_nom || "Joueur"}</p>
                <p className="text-sm" style={{ color: "var(--g-muted)" }}>
                  Match à {formatTime(result.reservation.heure_debut)}
                </p>
                {reste > 0 ? (
                  <p
                    className="rounded-xl px-3 py-2.5 text-sm font-semibold"
                    style={{
                      background: "color-mix(in srgb, var(--color-warning) 16%, white)",
                      color: "var(--color-warning)",
                    }}
                  >
                    💵 Encaisse {formatMoney(reste)} FCFA sur place
                  </p>
                ) : (
                  <p className="text-sm font-medium text-[var(--color-success)]">
                    ✓ Totalement payé — rien à encaisser
                  </p>
                )}
              </div>
            )}

            {result.state === "too_early" && (
              <div className="space-y-1">
                <p className="text-sm" style={{ color: "var(--g-muted)" }}>{result.text}</p>
                {result.minutesRemaining != null && (
                  <p className="text-sm font-semibold text-[var(--color-warning)]">
                    Encore {result.minutesRemaining} minute{result.minutesRemaining > 1 ? "s" : ""}
                  </p>
                )}
              </div>
            )}

            {result.state !== "success" && result.state !== "too_early" && result.text && (
              <p className="text-sm" style={{ color: "var(--g-muted)" }}>{result.text}</p>
            )}

            <div className="pt-2 flex flex-col gap-2">
              {result.state !== "success" && (
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  onClick={() => setResult({ state: "idle" })}
                >
                  Retour à la recherche
                </Button>
              )}
              <Button type="button" variant="hero" className="w-full" onClick={onClose}>
                Fermer
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
