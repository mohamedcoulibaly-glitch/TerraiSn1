import { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { gerantApi } from "@/lib/api";
import { localYmd } from "@/lib/localDate";

export type FicheGroupe = {
  id: string;
  type_blocage: string;
  libelle?: string | null;
  date_debut?: string;
  date_fin?: string;
  jours?: string | null;
  heure_debut?: string;
  heure_fin?: string;
  montant_contrat?: number;
  montant_encaisse?: number;
  reste_a_encaisser?: number;
  nb_encaissements?: number;
  nb_creneaux?: number;
  encaissements?: Array<{
    id: number;
    montant: number;
    date_encaissement: string;
    note?: string | null;
  }>;
};

const JOUR_COURT: Record<string, string> = {
  lundi: "Lun",
  mardi: "Mar",
  mercredi: "Mer",
  jeudi: "Jeu",
  vendredi: "Ven",
  samedi: "Sam",
  dimanche: "Dim",
};

function fcfa(n?: number) {
  return `${Number(n || 0).toLocaleString("fr-FR")} FCFA`;
}

function formatJour(ymd?: string) {
  if (!ymd) return "—";
  const d = new Date(`${String(ymd).slice(0, 10)}T12:00:00`);
  if (Number.isNaN(d.getTime())) return ymd;
  return d.toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });
}

function joursLabel(raw?: string | null) {
  const parts = String(raw || "")
    .split(",")
    .map((j) => JOUR_COURT[j.trim().toLowerCase()] || j.trim())
    .filter(Boolean);
  return parts.length ? parts.join(", ") : "—";
}

export function FicheBlocageGroupe({
  id,
  onBack,
}: {
  id: string;
  onBack: () => void;
}) {
  const [fiche, setFiche] = useState<FicheGroupe | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [montant, setMontant] = useState("");
  const [date, setDate] = useState(localYmd());
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setError("");
    gerantApi
      .getBlocageGroupe(id)
      .then((payload) => {
        if (!mounted) return;
        setFiche(((payload as { groupe?: FicheGroupe }).groupe || payload) as FicheGroupe);
      })
      .catch((err) => {
        if (!mounted) return;
        setFiche(null);
        setError(err instanceof Error ? err.message : "Impossible de charger cette fiche");
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [id]);

  const isTournoi = fiche?.type_blocage === "TOURNOI";
  const contrat = Number(fiche?.montant_contrat || 0);
  const encaisse = Number(fiche?.montant_encaisse || 0);
  const reste = Number(fiche?.reste_a_encaisser || 0);
  const canEncaisser = contrat <= 0 || reste > 0;

  const handleEncaisser = async () => {
    const value = Number(montant);
    if (!(value > 0)) {
      toast.error("Indique un montant à encaisser");
      return;
    }
    if (contrat > 0 && value > reste) {
      toast.error(`Le reste à encaisser est de ${fcfa(reste)}`);
      return;
    }
    setBusy(true);
    try {
      const result = (await gerantApi.encaisserBlocageGroupe(id, {
        montant: value,
        date_encaissement: date || localYmd(),
        note: note.trim() || undefined,
      })) as { fiche?: FicheGroupe };
      if (result?.fiche) setFiche(result.fiche);
      setMontant("");
      setNote("");
      toast.success(`${fcfa(value)} encaissé`);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Encaissement impossible");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-1 text-sm font-semibold min-h-[44px]"
        style={{ color: "var(--g-primary)" }}
      >
        <ArrowLeft className="w-4 h-4" />
        Réservations
      </button>

      {loading ? (
        <div className="animate-pulse space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-24 rounded-2xl" style={{ background: "var(--g-surface-2)" }} />
          ))}
        </div>
      ) : error ? (
        <p className="text-sm text-center py-8" style={{ color: "var(--g-danger)" }}>
          {error}
        </p>
      ) : !fiche ? (
        <p className="text-sm text-center py-8" style={{ color: "var(--g-muted)" }}>
          Fiche introuvable
        </p>
      ) : (
        <>
          <section
            className="rounded-2xl p-4"
            style={{ background: "var(--g-surface)", boxShadow: "var(--g-shadow)" }}
          >
            <p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--g-muted)" }}>
              {isTournoi ? "Tournoi" : "Abonnement"}
            </p>
            <h2 className="text-lg font-bold mt-1" style={{ color: "var(--g-text)", fontFamily: "var(--font-display)" }}>
              {fiche.libelle || (isTournoi ? "Tournoi" : "Abonnement")}
            </h2>
            <p className="text-xs mt-2" style={{ color: "var(--g-muted)" }}>
              {formatJour(fiche.date_debut)} → {formatJour(fiche.date_fin)}
            </p>
            <p className="text-xs mt-0.5" style={{ color: "var(--g-muted)" }}>
              {joursLabel(fiche.jours)} · {String(fiche.heure_debut || "").slice(0, 5)} → {String(fiche.heure_fin || "").slice(0, 5)}
            </p>
          </section>

          <section className="grid grid-cols-2 gap-2">
            <div className="rounded-xl p-3" style={{ background: "var(--g-surface)", boxShadow: "var(--g-shadow)" }}>
              <p className="text-[11px]" style={{ color: "var(--g-muted)" }}>
                Montant prévu
              </p>
              <p className="text-sm font-bold mt-1" style={{ color: "var(--g-text)" }}>
                {contrat > 0 ? fcfa(contrat) : "Non renseigné"}
              </p>
            </div>
            <div className="rounded-xl p-3" style={{ background: "var(--g-surface)", boxShadow: "var(--g-shadow)" }}>
              <p className="text-[11px]" style={{ color: "var(--g-muted)" }}>
                Déjà encaissé
              </p>
              <p className="text-sm font-bold mt-1" style={{ color: "var(--g-primary)" }}>
                {fcfa(encaisse)}
              </p>
            </div>
          </section>

          {encaisse === 0 ? (
            <p
              className="text-xs leading-relaxed rounded-xl px-3 py-2.5"
              style={{ background: "var(--g-surface-2)", color: "var(--g-muted)" }}
            >
              {isTournoi
                ? "Aucun montant encaissé pour ce tournoi"
                : "Aucun montant encaissé pour cet abonnement"}
            </p>
          ) : contrat > 0 ? (
            <p className="text-xs" style={{ color: "var(--g-text-2)" }}>
              Reste à encaisser : {fcfa(reste)}
            </p>
          ) : null}

          {canEncaisser ? (
            <section
              className="rounded-2xl p-4 space-y-3"
              style={{ background: "var(--g-surface)", boxShadow: "var(--g-shadow)" }}
            >
              <h3 className="text-sm font-semibold" style={{ color: "var(--g-text)" }}>
                Encaisser
              </h3>
              <label className="block">
                <span className="text-xs font-semibold mb-1.5 block" style={{ color: "var(--g-text-2)" }}>
                  Montant (FCFA)
                </span>
                <input
                  type="number"
                  min={0}
                  max={contrat > 0 ? reste : undefined}
                  value={montant}
                  onChange={(e) => setMontant(e.target.value)}
                  placeholder={contrat > 0 ? String(reste) : "Ex. 50000"}
                  className="h-12 w-full px-3 rounded-xl text-sm outline-none"
                  style={{
                    background: "var(--g-surface-2)",
                    color: "var(--g-text)",
                    border: "1px solid var(--g-border)",
                  }}
                />
              </label>
              <label className="block">
                <span className="text-xs font-semibold mb-1.5 block" style={{ color: "var(--g-text-2)" }}>
                  Date
                </span>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="h-12 w-full px-3 rounded-xl text-sm outline-none"
                  style={{
                    background: "var(--g-surface-2)",
                    color: "var(--g-text)",
                    border: "1px solid var(--g-border)",
                  }}
                />
              </label>
              <label className="block">
                <span className="text-xs font-semibold mb-1.5 block" style={{ color: "var(--g-text-2)" }}>
                  Note (optionnel)
                </span>
                <input
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Ex. 1re tranche Wave"
                  className="h-12 w-full px-3 rounded-xl text-sm outline-none"
                  style={{
                    background: "var(--g-surface-2)",
                    color: "var(--g-text)",
                    border: "1px solid var(--g-border)",
                  }}
                />
              </label>
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleEncaisser()}
                className="w-full min-h-[48px] rounded-xl text-sm font-semibold text-white disabled:opacity-50"
                style={{ background: "var(--g-primary)" }}
              >
                {busy ? "Encaissement…" : "Encaisser"}
              </button>
            </section>
          ) : (
            <p
              className="text-sm text-center py-4 rounded-xl"
              style={{ background: "var(--g-libre-bg)", color: "var(--g-libre)" }}
            >
              Contrat soldé
            </p>
          )}

          <section>
            <h3 className="text-sm font-semibold mb-3" style={{ color: "var(--g-text)" }}>
              Historique des encaissements
            </h3>
            {(fiche.encaissements || []).length === 0 ? (
              <p
                className="text-sm text-center py-8 rounded-xl"
                style={{ color: "var(--g-muted)", background: "var(--g-surface)" }}
              >
                Aucun encaissement pour le moment
              </p>
            ) : (
              <ul className="space-y-2">
                {(fiche.encaissements || []).map((e) => (
                  <li
                    key={e.id}
                    className="rounded-xl p-3 flex items-start justify-between gap-3"
                    style={{ background: "var(--g-surface)", boxShadow: "var(--g-shadow)" }}
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium" style={{ color: "var(--g-text)" }}>
                        {formatJour(e.date_encaissement)}
                      </p>
                      {e.note ? (
                        <p className="text-xs mt-0.5" style={{ color: "var(--g-muted)" }}>
                          {e.note}
                        </p>
                      ) : null}
                    </div>
                    <p className="text-sm font-bold shrink-0" style={{ color: "var(--g-primary)" }}>
                      {fcfa(e.montant)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
