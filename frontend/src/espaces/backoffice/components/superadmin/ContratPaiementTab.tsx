import { useMemo, useState } from "react";
import {
  ArrowRightLeft,
  Check,
  CreditCard,
  DollarSign,
  Handshake,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Zap,
  Hand,
} from "lucide-react";
import { toast } from "sonner";
import { superAdminApi } from "@/services/superAdminApi";
import PreviewContrat from "./PreviewContrat";
import ConfirmationModal from "./ConfirmationModal";
import AlerteBandeau from "./AlerteBandeau";
import PctMontantPair from "@/components/PctMontantPair";
import {
  type CanalReversement,
  type CanalStatut,
  type ContratOverlay,
  type FraisPolitique,
  type PayoutMode,
  digitsSn,
  formatTelAffichage,
  fraisLabel,
  saveContratOverlay,
  statutCanalDepuisNumero,
  texteAnnulationJoueur,
  texteImpactReversement,
  fcfa,
} from "@/lib/saContrat";
import { usePreviewContrat } from "@/hooks/usePreviewContrat";

type GerantInfo = { nom: string; telephone?: string } | null;
type PolitiquePaiement = "avance" | "sans_avance";

type Props = {
  terrain: any;
  contrat: ContratOverlay;
  gerant: GerantInfo;
  onChange: (next: ContratOverlay) => void;
  auteur: string;
};

function apercuEcheanceDette(delaiJours: number) {
  const now = new Date();
  const finMois = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  finMois.setDate(finMois.getDate() + Math.max(0, delaiJours));
  const moisCourant = now.toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
  const echeance = finMois.toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  return `Pour ${moisCourant} → échéance le ${echeance}`;
}

function Pill({
  active,
  children,
  onClick,
  tone = "primary",
}: {
  active: boolean;
  children: React.ReactNode;
  onClick: () => void;
  tone?: "primary" | "success";
}) {
  const color = tone === "success" ? "var(--sa-success)" : "var(--sa-primary)";
  const bg = tone === "success" ? "var(--sa-success-bg)" : "var(--sa-primary-glow)";
  return (
    <button
      type="button"
      onClick={onClick}
      className="px-3 min-h-[36px] rounded-full text-[12px] font-semibold"
      style={{
        background: active ? color : "var(--sa-surface)",
        color: active ? "var(--sa-surface)" : "var(--sa-text-2)",
        border: active ? `1px solid ${color}` : "1px solid var(--sa-border)",
        boxShadow: active ? "none" : undefined,
      }}
    >
      {children}
    </button>
  );
}

function CanalStatutBadge({ statut, date, tone }: { statut: CanalStatut; date?: string; tone: "wave" | "om" }) {
  const map: Record<CanalStatut, { label: string; color: string; bg: string }> = {
    absent: { label: "Non configuré", color: "var(--sa-absent)", bg: "var(--sa-absent-bg)" },
    saisi: { label: "Non testé", color: "var(--sa-warning)", bg: "var(--sa-warning-bg)" },
    test_envoye: { label: "Test en cours", color: "var(--sa-warning)", bg: "var(--sa-warning-bg)" },
    verifie: {
      label: date ? `Vérifié ✓ · ${new Date(date).toLocaleDateString("fr-FR")}` : "Vérifié ✓",
      color: "var(--sa-verifie)",
      bg: "var(--sa-verifie-bg)",
    },
  };
  const m = map[statut];
  const color = tone === "om" && statut !== "verifie" && statut !== "absent" ? "var(--sa-om)" : m.color;
  return (
    <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ background: m.bg, color }}>
      {m.label}
    </span>
  );
}

function CheckRow({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2 text-[13px]">
      <span
        className="w-5 h-5 rounded-full grid place-items-center text-[11px] font-bold"
        style={{
          background: ok ? "var(--sa-success-bg)" : "var(--sa-danger-bg)",
          color: ok ? "var(--sa-success)" : "var(--sa-danger)",
        }}
      >
        {ok ? "✓" : "✗"}
      </span>
      <span style={{ color: "var(--sa-text-2)" }}>{label}</span>
    </div>
  );
}

export default function ContratPaiementTab({ terrain, contrat, gerant, onChange, auteur }: Props) {
  const initialPolitique: PolitiquePaiement =
    terrain.politique_paiement === "sans_avance" ? "sans_avance" : "avance";
  const [politiquePaiement, setPolitiquePaiement] = useState<PolitiquePaiement>(initialPolitique);
  const [delaiDette, setDelaiDette] = useState(String(terrain.delai_paiement_dette_jours ?? 30));
  const [avance, setAvance] = useState(String(terrain.pourcentage_avance ?? 8));
  const [commission, setCommission] = useState(String(terrain.commission_pourcentage ?? 10));
  const [saving, setSaving] = useState<string | null>(null);
  const [sameWhatsapp, setSameWhatsapp] = useState(contrat.numeros_identiques_whatsapp);
  const [wave, setWave] = useState(contrat.wave_numero);
  const [om, setOm] = useState(contrat.om_numero);
  const [canal, setCanal] = useState<CanalReversement>(contrat.canal_reversement);
  const [remb, setRemb] = useState(contrat.remboursement_autorise || Number(terrain.delai_remboursement_heures || 0) > 0);
  const [delai, setDelai] = useState(String(terrain.delai_remboursement_heures ?? 0));
  const [delaiVerrou, setDelaiVerrou] = useState(String(terrain.delai_verrou_paiement_min ?? 15));
  const [mode, setMode] = useState<PayoutMode>(contrat.payout_mode);
  const [politique, setPolitique] = useState<FraisPolitique>(contrat.payout_frais_politique);
  const [pctG, setPctG] = useState(String(contrat.frais_payout_pct_gerant ?? 1));
  const [pctP, setPctP] = useState(String(contrat.frais_payout_pct_plateforme ?? 1));
  const [confirmProd, setConfirmProd] = useState(false);
  const [confirmVerif, setConfirmVerif] = useState<"wave" | "om" | null>(null);
  const [histOpen, setHistOpen] = useState(false);

  const sansAvance = politiquePaiement === "sans_avance";
  const delaiDetteNum = Math.max(7, Math.min(90, Number(delaiDette) || 30));
  const pctAvance = Number(avance) || 0;
  const pctCommission = Number(commission) || 0;
  const preview = usePreviewContrat({
    pctAvance,
    pctCommission,
    mode,
    politiqueFrais: politique,
    pctFraisGerant: Number(pctG) || 0,
    pctFraisPlateforme: Number(pctP) || 0,
  });

  const whatsapp = gerant?.telephone || "";
  const waveStatut = contrat.wave_statut;
  const omStatut = contrat.om_statut;

  const commercialOk = sansAvance ? pctCommission >= 0 : pctAvance > 0 && pctCommission >= 0;
  const numerosOk = sansAvance || waveStatut === "verifie" || omStatut === "verifie";
  const politiqueOk = sansAvance || !remb || Number(delai) > 0;
  const modeOk = sansAvance || mode === "auto" || mode === "retrait";
  const allOk = commercialOk && numerosOk && politiqueOk && modeOk;
  const production = contrat.production_paiement;

  const gerantPrenomNom = gerant?.nom || "Non assigné";

  async function persist(patch: Partial<ContratOverlay>, bloc: string, avant: string, apres: string) {
    const next = saveContratOverlay(terrain.id, patch, { par: auteur, bloc, avant, apres });
    onChange(next);
    return next;
  }

  async function savePolitiquePaiementMode() {
    setSaving("politique-paiement");
    try {
      const updated = (await superAdminApi.politiquePaiement(terrain.id, {
        politique_paiement: politiquePaiement,
        delai_paiement_dette_jours: delaiDetteNum,
      })) as { politique_paiement?: string; delai_paiement_dette_jours?: number };
      const nextPol =
        String(updated?.politique_paiement || politiquePaiement) === "sans_avance" ? "sans_avance" : "avance";
      setPolitiquePaiement(nextPol);
      setDelaiDette(String(updated?.delai_paiement_dette_jours ?? delaiDetteNum));
      await persist(
        {},
        "Politique paiement",
        `${terrain.politique_paiement || "avance"} · ${terrain.delai_paiement_dette_jours || 30} j`,
        `${nextPol} · ${updated?.delai_paiement_dette_jours ?? delaiDetteNum} j`,
      );
      toast.success("Politique de paiement enregistrée");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Enregistrement impossible");
    } finally {
      setSaving(null);
    }
  }

  async function saveDelaiDetteSeul() {
    setSaving("delai-dette");
    try {
      const updated = (await superAdminApi.politiquePaiement(terrain.id, {
        delai_paiement_dette_jours: delaiDetteNum,
      })) as { delai_paiement_dette_jours?: number };
      if (updated?.delai_paiement_dette_jours != null) {
        setDelaiDette(String(updated.delai_paiement_dette_jours));
      }
      toast.success(`Délai dette : ${delaiDetteNum} jours`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Enregistrement impossible");
    } finally {
      setSaving(null);
    }
  }

  async function saveCommercial() {
    setSaving("commercial");
    try {
      await superAdminApi.updateTarifs(terrain.id, {
        pourcentage_avance: sansAvance ? Number(terrain.pourcentage_avance ?? pctAvance) : pctAvance,
        commission_pourcentage: pctCommission,
        modele_revenus: terrain.modele_revenus || "commission",
      });
      await persist({}, "Commercial", `${terrain.pourcentage_avance}% / ${terrain.commission_pourcentage}%`, `${pctAvance}% / ${pctCommission}%`);
      toast.success("Bloc commercial enregistré");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Enregistrement impossible");
    } finally {
      setSaving(null);
    }
  }

  function applySameWhatsapp(checked: boolean) {
    setSameWhatsapp(checked);
    if (checked && whatsapp) {
      const formatted = formatTelAffichage(whatsapp);
      setWave(formatted);
      setOm(formatted);
    }
  }

  async function saveNumeros() {
    setSaving("numeros");
    try {
      const w = formatTelAffichage(wave);
      const o = formatTelAffichage(om);
      await persist(
        {
          wave_numero: w,
          om_numero: o,
          numeros_identiques_whatsapp: sameWhatsapp,
          canal_reversement: canal,
          wave_statut: statutCanalDepuisNumero(w, contrat.wave_statut),
          om_statut: statutCanalDepuisNumero(o, contrat.om_statut),
        },
        "Numéros gérant",
        `${contrat.wave_numero || "—"} / ${contrat.om_numero || "—"}`,
        `${w || "—"} / ${o || "—"}`,
      );
      toast.success("Numéros enregistrés");
    } finally {
      setSaving(null);
    }
  }

  async function envoyerTest(op: "wave" | "om") {
    const numero = op === "wave" ? wave : om;
    if (!digitsSn(numero)) return;
    setSaving(`test-${op}`);
    try {
      const patch =
        op === "wave"
          ? { wave_numero: formatTelAffichage(wave), wave_statut: "test_envoye" as CanalStatut }
          : { om_numero: formatTelAffichage(om), om_statut: "test_envoye" as CanalStatut };
      await persist(patch, `Test 100 FCFA ${op.toUpperCase()}`, contrat[op === "wave" ? "wave_statut" : "om_statut"], "test_envoye");
      toast.success("Test 100 FCFA marqué comme envoyé (hors moteur PayTech pour l’instant)");
    } finally {
      setSaving(null);
    }
  }

  async function marquerVerifie(op: "wave" | "om") {
    const now = new Date().toISOString();
    const patch =
      op === "wave"
        ? { wave_statut: "verifie" as CanalStatut, wave_verifie_at: now }
        : { om_statut: "verifie" as CanalStatut, om_verifie_at: now };
    await persist(patch, `Vérif ${op.toUpperCase()}`, "test_envoye", "verifie");
    setConfirmVerif(null);
    toast.success("Canal marqué comme vérifié");
  }

  async function savePolitique() {
    setSaving("politique");
    try {
      const heures = remb ? Number(delai) || 0 : 0;
      await superAdminApi.politiqueAnnulation(terrain.id, heures);
      await persist(
        { remboursement_autorise: remb && heures > 0 },
        "Politique annulation",
        contrat.remboursement_autorise ? `${terrain.delai_remboursement_heures} h` : "Non",
        remb ? `${heures} h` : "Non",
      );
      toast.success("Politique d’annulation enregistrée");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Enregistrement impossible");
    } finally {
      setSaving(null);
    }
  }

  async function saveDelaiVerrou() {
    setSaving("verrou");
    try {
      const minutes = Math.max(1, Math.min(120, Number(delaiVerrou) || 15));
      const updated = (await superAdminApi.delaiVerrouPaiement(terrain.id, minutes)) as {
        delai_verrou_paiement_min?: number;
      };
      setDelaiVerrou(String(updated?.delai_verrou_paiement_min ?? minutes));
      toast.success(`Délai de confirmation : ${minutes} min`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Enregistrement impossible");
    } finally {
      setSaving(null);
    }
  }

  async function saveMode() {
    setSaving("mode");
    try {
      await persist(
        {
          payout_mode: mode,
          payout_frais_politique: politique,
          frais_payout_pct_gerant: Number(pctG) || 0,
          frais_payout_pct_plateforme: Number(pctP) || 0,
        },
        "Mode reversement",
        `${contrat.payout_mode} · ${fraisLabel(contrat)}`,
        `${mode} · ${politique}`,
      );
      toast.success("Mode et frais enregistrés");
    } finally {
      setSaving(null);
    }
  }

  async function activerProduction() {
    await persist({ production_paiement: true }, "Production paiement", "inactive", "active");
    setConfirmProd(false);
    toast.success("Production paiement activée (flag local — moteur à brancher)");
  }

  const twoNumbers = Boolean(digitsSn(wave) && digitsSn(om));
  const lockedNums = sameWhatsapp;

  const checks = useMemo(
    () => [
      { ok: commercialOk, label: "Bloc commercial" },
      { ok: numerosOk, label: "Numéros gérant (au moins 1 canal vérifié)" },
      { ok: politiqueOk, label: "Politique annulation configurée" },
      { ok: modeOk, label: "Mode reversement configuré" },
    ],
    [commercialOk, numerosOk, politiqueOk, modeOk],
  );

  return (
    <div className="space-y-5">
      {!production ? (
        <AlerteBandeau
          type="warning"
          message="Ce terrain n'est pas encore actif en production paiement. Configurez les 4 blocs et vérifiez au moins un canal de reversement."
        />
      ) : null}

      {/* BLOC 0 — Politique de paiement */}
      <section
        className="rounded-xl p-5"
        style={{ background: "var(--sa-surface)", boxShadow: "var(--sa-shadow)", borderTop: "3px solid var(--sa-warning)" }}
      >
        <h3 className="flex items-center gap-2 text-[15px] font-semibold" style={{ color: "var(--sa-text)" }}>
          <CreditCard size={16} style={{ color: "var(--sa-warning)" }} />
          Politique de paiement
        </h3>

        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => setPolitiquePaiement("avance")}
            className="text-left rounded-xl p-4"
            style={{
              border: politiquePaiement === "avance" ? "2px solid var(--sa-success)" : "1px solid var(--sa-border)",
              background: politiquePaiement === "avance" ? "var(--sa-success-subtle)" : "var(--sa-surface)",
            }}
          >
            <div className="flex items-center gap-2 mb-2">
              <ShieldCheck size={18} style={{ color: "var(--sa-success)" }} />
              <span className="text-[13px] font-semibold" style={{ color: "var(--sa-text)" }}>
                Avec avance (standard)
              </span>
            </div>
            <p className="text-[12px] font-medium" style={{ color: "var(--sa-text)" }}>
              Paiement en ligne obligatoire
            </p>
            <p className="mt-1 text-[12px]" style={{ color: "var(--sa-muted)" }}>
              Le joueur paie une avance via Wave ou Orange Money avant que sa réservation soit confirmée.
              Commission prélevée automatiquement.
            </p>
          </button>

          <button
            type="button"
            onClick={() => setPolitiquePaiement("sans_avance")}
            className="text-left rounded-xl p-4"
            style={{
              border: politiquePaiement === "sans_avance" ? "2px solid var(--sa-warning)" : "1px solid var(--sa-border)",
              background: politiquePaiement === "sans_avance" ? "var(--sa-warning-subtle)" : "var(--sa-surface)",
            }}
          >
            <div className="flex items-center gap-2 mb-2">
              <Handshake size={18} style={{ color: "var(--sa-warning)" }} />
              <span className="text-[13px] font-semibold" style={{ color: "var(--sa-text)" }}>
                Sans avance (sur parole)
              </span>
            </div>
            <p className="text-[12px] font-medium" style={{ color: "var(--sa-text)" }}>
              Confirmation sans paiement
            </p>
            <p className="mt-1 text-[12px]" style={{ color: "var(--sa-muted)" }}>
              La réservation est confirmée directement sans paiement en ligne. Le joueur paie sur place.
              La commission s&apos;accumule en dette mensuelle.
            </p>
            {sansAvance ? (
              <p className="mt-2 text-[11px]" style={{ color: "var(--sa-warning)" }}>
                ⚠️ Ce mode désactive PayTech pour ce terrain. La commission sera facturée en fin de période.
              </p>
            ) : null}
          </button>
        </div>

        {sansAvance ? (
          <div className="mt-4 space-y-3">
            <label className="block max-w-xs">
              <span className="text-[12px] font-medium" style={{ color: "var(--sa-text-2)" }}>
                Délai de paiement de la dette commission (jours)
              </span>
              <input
                type="number"
                min={7}
                max={90}
                value={delaiDette}
                onChange={(e) => setDelaiDette(e.target.value)}
                className="mt-1 w-full h-11 rounded-lg px-3 text-sm"
                style={{ border: "1px solid var(--sa-border)", color: "var(--sa-text)" }}
              />
              <span className="mt-1 block text-[11px]" style={{ color: "var(--sa-muted)" }}>
                Le gérant dispose de {delaiDetteNum} jours après la fin du mois pour régler sa dette commission.
              </span>
              <span className="mt-1 block text-[12px] font-medium" style={{ color: "var(--sa-text-2)" }}>
                {apercuEcheanceDette(delaiDetteNum)}
              </span>
            </label>
          </div>
        ) : null}

        <button
          type="button"
          disabled={saving === "politique-paiement"}
          onClick={savePolitiquePaiementMode}
          className="mt-4 min-h-[44px] px-4 rounded-lg text-[13px] font-semibold text-white"
          style={{ background: "var(--sa-primary)" }}
        >
          {saving === "politique-paiement" ? "Enregistrement…" : "Enregistrer la politique"}
        </button>

        <div
          className="mt-5 rounded-xl p-4"
          style={{ background: "var(--sa-surface-2)", border: "1px solid var(--sa-border)" }}
        >
          <p className="text-[13px] font-semibold" style={{ color: "var(--sa-text)" }}>
            Délai dette commission
          </p>
          <p className="mt-1 text-[12px]" style={{ color: "var(--sa-muted)" }}>
            Délai accordé au gérant pour régler la dette commission (confirmations manuelles et sans avance).
          </p>
          <label className="mt-3 block max-w-xs">
            <span className="text-[12px] font-medium" style={{ color: "var(--sa-text-2)" }}>Jours</span>
            <input
              type="number"
              min={7}
              max={90}
              value={delaiDette}
              onChange={(e) => setDelaiDette(e.target.value)}
              className="mt-1 w-full h-11 rounded-lg px-3 text-sm"
              style={{ border: "1px solid var(--sa-border)", color: "var(--sa-text)", background: "var(--sa-surface)" }}
            />
          </label>
          <button
            type="button"
            disabled={saving === "delai-dette"}
            onClick={saveDelaiDetteSeul}
            className="mt-3 min-h-[40px] px-3 rounded-lg text-[12px] font-semibold"
            style={{ background: "var(--sa-primary-glow)", color: "var(--sa-primary)" }}
          >
            {saving === "delai-dette" ? "Enregistrement…" : "Enregistrer le délai"}
          </button>
        </div>
      </section>

      {/* BLOC 1 */}
      <section className="rounded-xl p-5" style={{ background: "var(--sa-surface)", boxShadow: "var(--sa-shadow)", borderTop: "3px solid var(--sa-primary)" }}>
        <h3 className="flex items-center gap-2 text-[15px] font-semibold" style={{ color: "var(--sa-text)" }}>
          <DollarSign size={16} style={{ color: "var(--sa-primary)" }} />
          Commercial
        </h3>
        <div className="mt-4 space-y-4">
          {!sansAvance ? (
            <PctMontantPair
              label="Avance joueur"
              labelMontant="Montant avance"
              hint="Proportion du prix total payée en ligne par le joueur"
              pct={avance}
              onPctChange={setAvance}
              base={preview.prix}
            />
          ) : null}
          <PctMontantPair
            label="Commission TerrainSN"
            labelMontant="Montant commission"
            hint={sansAvance ? "Calculée sur l'avance théorique (même sans encaissement)" : "Prélevée uniquement sur l'avance"}
            pct={commission}
            onPctChange={setCommission}
            base={preview.avance}
          />
        </div>

        {!sansAvance ? (
          <div className="mt-4 rounded-[10px] p-4" style={{ background: "var(--sa-primary-glow)" }}>
            <p className="text-[13px] font-semibold mb-2" style={{ color: "var(--sa-text)" }}>
              Aperçu sur un créneau à 40 000 FCFA
            </p>
            <dl className="space-y-1 text-[13px]">
              {[
                ["Prix du créneau", fcfa(preview.prix)],
                ["Avance joueur", `${fcfa(preview.avance)} (${pctAvance}%)`],
                ["Reste sur place", fcfa(preview.reste)],
                ["Commission TerrainSN", fcfa(preview.commission)],
                ["Base gérant", fcfa(preview.baseGerant)],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-4">
                  <dt style={{ color: "var(--sa-text-2)" }}>{k}</dt>
                  <dd className="font-medium" style={{ color: "var(--sa-text)" }}>{v}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-3 text-[12px]" style={{ color: "var(--sa-muted)" }}>
              Bénéficiaire (non modifiable) :{" "}
              <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ background: "var(--sa-primary-glow)", color: "var(--sa-primary)" }}>
                Gérant — {gerantPrenomNom}
              </span>
            </p>
          </div>
        ) : null}

        <button
          type="button"
          disabled={saving === "commercial"}
          onClick={saveCommercial}
          className="mt-4 min-h-[44px] px-4 rounded-lg text-[13px] font-semibold text-white"
          style={{ background: "var(--sa-primary)" }}
        >
          {saving === "commercial" ? "Enregistrement…" : "Enregistrer le bloc commercial"}
        </button>
      </section>

      {/* BLOC 2 */}
      <section
        className="rounded-xl p-5 relative"
        style={{
          background: "var(--sa-surface)",
          boxShadow: "var(--sa-shadow)",
          borderTop: "3px solid var(--sa-wave)",
          opacity: sansAvance ? 0.55 : 1,
          pointerEvents: sansAvance ? "none" : undefined,
        }}
      >
        {sansAvance ? (
          <p className="mb-3 text-[12px] font-medium" style={{ color: "var(--sa-muted)" }}>
            Non requis en mode sans avance — le paiement se fait sur place
          </p>
        ) : null}
        <h3 className="flex items-center gap-2 text-[15px] font-semibold" style={{ color: "var(--sa-text)" }}>
          <Smartphone size={16} style={{ color: "var(--sa-wave)" }} />
          Reversement — Numéros du gérant
        </h3>
        <p className="mt-2 text-[12px]" style={{ color: "var(--sa-muted)" }}>
          L'argent sera reversé sur ces numéros. Ils appartiennent au gérant, pas au propriétaire.
        </p>

        <label className="mt-4 block">
          <span className="text-[12px] font-medium" style={{ color: "var(--sa-text-2)" }}>WhatsApp du gérant (référence)</span>
          <div className="mt-1 h-11 rounded-lg px-3 flex items-center text-sm" style={{ border: "1px solid var(--sa-border)", background: "var(--sa-surface-2)", color: "var(--sa-text-2)" }}>
            <span className="mr-2" style={{ color: "var(--sa-success)" }}>●</span>
            {whatsapp ? formatTelAffichage(whatsapp) : "Aucun gérant assigné"}
          </div>
        </label>

        <label className="mt-3 flex items-center gap-2 text-[13px]" style={{ color: "var(--sa-text)" }}>
          <input type="checkbox" checked={sameWhatsapp} onChange={(e) => applySameWhatsapp(e.target.checked)} />
          Utiliser le même numéro pour Wave et Orange Money
        </label>

        {(["wave", "om"] as const).map((op) => {
          const isWave = op === "wave";
          const value = isWave ? wave : om;
          const setValue = isWave ? setWave : setOm;
          const statut = isWave ? waveStatut : omStatut;
          const date = isWave ? contrat.wave_verifie_at : contrat.om_verifie_at;
          const empty = !digitsSn(value);
          return (
            <div key={op} className="mt-4">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[12px] font-medium" style={{ color: "var(--sa-text-2)" }}>
                  {isWave ? "Numéro Wave" : "Numéro Orange Money"}
                </span>
                <CanalStatutBadge statut={statut} date={date} tone={op} />
              </div>
              <input
                type="tel"
                value={value}
                disabled={lockedNums}
                placeholder="+221 7X XXX XX XX"
                onChange={(e) => setValue(e.target.value)}
                className="mt-1 w-full h-11 rounded-lg px-3 text-sm disabled:opacity-60"
                style={{ border: "1px solid var(--sa-border)", background: lockedNums ? "var(--sa-surface-2)" : "var(--sa-surface)", color: "var(--sa-text)" }}
              />
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={empty || statut === "verifie" || saving === `test-${op}`}
                  onClick={() => envoyerTest(op)}
                  className="min-h-[40px] px-3 rounded-lg text-[12px] font-semibold disabled:opacity-40"
                  style={{ background: isWave ? "var(--sa-wave-bg)" : "var(--sa-om-bg)", color: isWave ? "var(--sa-wave)" : "var(--sa-om)" }}
                >
                  {saving === `test-${op}` ? "Envoi en cours..." : "Envoyer test 100 FCFA"}
                </button>
                {statut === "test_envoye" ? (
                  <button
                    type="button"
                    onClick={() => setConfirmVerif(op)}
                    className="min-h-[40px] px-3 rounded-lg text-[12px] font-semibold"
                    style={{ background: "var(--sa-success-bg)", color: "var(--sa-success)" }}
                  >
                    Marquer comme vérifié
                  </button>
                ) : null}
              </div>
            </div>
          );
        })}

        {twoNumbers ? (
          <div className="mt-4">
            <p className="text-[12px] font-medium mb-2" style={{ color: "var(--sa-text-2)" }}>Canal préféré de reversement</p>
            <div className="flex flex-wrap gap-2">
              <Pill active={canal === "wave"} onClick={() => setCanal("wave")}>Wave</Pill>
              <Pill active={canal === "om"} onClick={() => setCanal("om")}>Orange Money</Pill>
              <Pill active={canal === "les_deux"} onClick={() => setCanal("les_deux")}>Les deux (Wave → OM)</Pill>
            </div>
          </div>
        ) : null}

        <button
          type="button"
          disabled={saving === "numeros"}
          onClick={saveNumeros}
          className="mt-4 min-h-[44px] px-4 rounded-lg text-[13px] font-semibold text-white"
          style={{ background: "var(--sa-primary)" }}
        >
          {saving === "numeros" ? "Enregistrement…" : "Enregistrer les numéros"}
        </button>
      </section>

      {/* BLOC 3 */}
      <section
        className="rounded-xl p-5"
        style={{
          background: "var(--sa-surface)",
          boxShadow: "var(--sa-shadow)",
          borderTop: "3px solid var(--sa-warning)",
          opacity: sansAvance ? 0.55 : 1,
          pointerEvents: sansAvance ? "none" : undefined,
        }}
      >
        {sansAvance ? (
          <p className="mb-3 text-[12px] font-medium" style={{ color: "var(--sa-muted)" }}>
            Non applicable — pas de paiement en ligne à rembourser
          </p>
        ) : null}
        <h3 className="flex items-center gap-2 text-[15px] font-semibold" style={{ color: "var(--sa-text)" }}>
          <RefreshCw size={16} style={{ color: "var(--sa-warning)" }} />
          Politique d'annulation
        </h3>
        <div className="mt-4 flex items-center gap-3">
          <button
            type="button"
            role="switch"
            aria-checked={remb}
            aria-label="Remboursement autorisé"
            onClick={() => setRemb(!remb)}
            className="sa-switch"
          >
            <span className="sa-switch-thumb" />
          </button>
          <span className="text-[13px]" style={{ color: "var(--sa-text)" }}>
            {remb ? "Oui — remboursement possible dans le délai" : "Non — le joueur ne peut pas se faire rembourser"}
          </span>
        </div>
        {remb ? (
          <label className="mt-4 block max-w-xs">
            <span className="text-[12px] font-medium" style={{ color: "var(--sa-text-2)" }}>Délai en heures</span>
            <input
              type="number"
              min={1}
              value={delai}
              onChange={(e) => setDelai(e.target.value)}
              className="mt-1 w-full h-11 rounded-lg px-3 text-sm"
              style={{ border: "1px solid var(--sa-border)", color: "var(--sa-text)" }}
            />
            <span className="mt-1 block text-[11px]" style={{ color: "var(--sa-muted)" }}>
              Ex : 24 = le joueur peut annuler dans les 24h après confirmation
            </span>
          </label>
        ) : null}
        <div className="mt-4 rounded-lg p-3" style={{ background: "var(--sa-surface-2)" }}>
          <p className="text-[11px] font-medium mb-1" style={{ color: "var(--sa-muted)" }}>Ce que verra le joueur :</p>
          <p className="text-[13px]" style={{ color: "var(--sa-text)" }}>{texteAnnulationJoueur(remb, Number(delai) || 0)}</p>
        </div>
        <p className="mt-2 text-[12px]" style={{ color: "var(--sa-muted)" }}>
          Impact sur le reversement : {texteImpactReversement(remb, Number(delai) || 0)}
        </p>
        <button
          type="button"
          disabled={saving === "politique"}
          onClick={savePolitique}
          className="mt-4 min-h-[44px] px-4 rounded-lg text-[13px] font-semibold text-white"
          style={{ background: "var(--sa-primary)" }}
        >
          {saving === "politique" ? "Enregistrement…" : "Enregistrer la politique"}
        </button>
      </section>

      {/* Délai hold paiement */}
      <section className="rounded-xl p-5" style={{ background: "var(--sa-surface)", boxShadow: "var(--sa-shadow)", borderTop: "3px solid var(--sa-primary)" }}>
        <h3 className="flex items-center gap-2 text-[15px] font-semibold" style={{ color: "var(--sa-text)" }}>
          <Zap size={16} style={{ color: "var(--sa-primary)" }} />
          Délai de confirmation paiement
        </h3>
        <p className="mt-2 text-[13px]" style={{ color: "var(--sa-text-2)" }}>
          Quand un créneau est réservé en attente de paiement, il reste indisponible (joueur et gérant)
          pendant ce délai. Sans confirmation, il redevient libre automatiquement.
        </p>
        <label className="mt-4 block max-w-xs">
          <span className="text-[12px] font-medium" style={{ color: "var(--sa-text-2)" }}>Délai en minutes</span>
          <input
            type="number"
            min={1}
            max={120}
            value={delaiVerrou}
            onChange={(e) => setDelaiVerrou(e.target.value)}
            className="mt-1 w-full h-11 rounded-lg px-3 text-sm"
            style={{ border: "1px solid var(--sa-border)", color: "var(--sa-text)" }}
          />
          <span className="mt-1 block text-[11px]" style={{ color: "var(--sa-muted)" }}>
            Par défaut 15 min · max 120 min
          </span>
        </label>
        <button
          type="button"
          disabled={saving === "verrou"}
          onClick={saveDelaiVerrou}
          className="mt-4 min-h-[44px] px-4 rounded-lg text-[13px] font-semibold text-white"
          style={{ background: "var(--sa-primary)" }}
        >
          {saving === "verrou" ? "Enregistrement…" : "Enregistrer le délai"}
        </button>
      </section>

      {/* BLOC 4 */}
      <section
        className="rounded-xl p-5"
        style={{
          background: "var(--sa-surface)",
          boxShadow: "var(--sa-shadow)",
          borderTop: "3px solid var(--sa-success)",
          opacity: sansAvance ? 0.55 : 1,
          pointerEvents: sansAvance ? "none" : undefined,
        }}
      >
        {sansAvance ? (
          <p className="mb-3 text-[12px] font-medium" style={{ color: "var(--sa-muted)" }}>
            La commission est réglée manuellement en fin de période
          </p>
        ) : null}
        <h3 className="flex items-center gap-2 text-[15px] font-semibold" style={{ color: "var(--sa-text)" }}>
          <ArrowRightLeft size={16} style={{ color: "var(--sa-success)" }} />
          Mode de reversement et frais
        </h3>
        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => setMode("auto")}
            className="text-left rounded-xl p-4"
            style={{
              background: mode === "auto" ? "var(--sa-primary-glow)" : "var(--sa-surface)",
              border: mode === "auto" ? "1.5px solid var(--sa-primary)" : "1px solid var(--sa-border)",
            }}
          >
            <Zap size={18} style={{ color: "var(--sa-primary)" }} />
            <p className="mt-2 text-[14px] font-semibold" style={{ color: "var(--sa-text)" }}>Reversement automatique</p>
            <p className="mt-1 text-[12px]" style={{ color: "var(--sa-muted)" }}>
              PayTech envoie automatiquement le dû sur le numéro du gérant. Des frais de payout s'appliquent selon la politique ci-dessous.
            </p>
            <span className="mt-2 inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ background: "var(--sa-warning-bg)", color: "var(--sa-warning)" }}>
              Frais de payout
            </span>
          </button>
          <button
            type="button"
            onClick={() => setMode("retrait")}
            className="text-left rounded-xl p-4"
            style={{
              background: mode === "retrait" ? "var(--sa-success-bg)" : "var(--sa-surface)",
              border: mode === "retrait" ? "1.5px solid var(--sa-success)" : "1px solid var(--sa-border)",
            }}
          >
            <Hand size={18} style={{ color: "var(--sa-muted)" }} />
            <p className="mt-2 text-[14px] font-semibold" style={{ color: "var(--sa-text)" }}>Retrait à la demande</p>
            <p className="mt-1 text-[12px]" style={{ color: "var(--sa-muted)" }}>
              Le gérant clique Retirer. L'équipe reçoit un WhatsApp et vire manuellement. Aucun frais déduit.
            </p>
            <span className="mt-2 inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ background: "var(--sa-success-bg)", color: "var(--sa-success)" }}>
              0 frais
            </span>
          </button>
        </div>

        {mode === "auto" ? (
          <div className="mt-4">
            <p className="text-[12px] font-medium mb-2" style={{ color: "var(--sa-text-2)" }}>Qui prend en charge les frais de payout ?</p>
            <div className="flex flex-wrap gap-2">
              <Pill active={politique === "gerant"} onClick={() => setPolitique("gerant")}>Gérant (côté client)</Pill>
              <Pill active={politique === "plateforme"} onClick={() => setPolitique("plateforme")}>Plateforme</Pill>
              <Pill active={politique === "partage"} onClick={() => setPolitique("partage")}>Partage</Pill>
            </div>
            {politique === "partage" ? (
              <div className="mt-3 space-y-3 max-w-xl">
                <PctMontantPair
                  label="% Gérant"
                  labelMontant="Frais gérant"
                  pct={pctG}
                  onPctChange={setPctG}
                  base={preview.baseGerant}
                />
                <PctMontantPair
                  label="% Plateforme"
                  labelMontant="Frais plateforme"
                  pct={pctP}
                  onPctChange={setPctP}
                  base={preview.baseGerant}
                />
                <p className="text-[11px]" style={{ color: "var(--sa-muted)" }}>Ex: 1+1 = chacun prend 1% des frais sur la base gérant</p>
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="mt-4">
          <PreviewContrat
            pctAvance={pctAvance}
            pctCommission={pctCommission}
            mode={mode}
            politiqueFrais={politique}
            pctFraisGerant={Number(pctG) || 0}
            pctFraisPlateforme={Number(pctP) || 0}
          />
        </div>

        <button
          type="button"
          disabled={saving === "mode"}
          onClick={saveMode}
          className="mt-4 min-h-[44px] px-4 rounded-lg text-[13px] font-semibold text-white"
          style={{ background: "var(--sa-primary)" }}
        >
          {saving === "mode" ? "Enregistrement…" : "Enregistrer le mode et les frais"}
        </button>
      </section>

      {/* Validation finale */}
      <section className="rounded-xl p-5" style={{ background: "var(--sa-surface)", boxShadow: "var(--sa-shadow)" }}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {checks.map((c) => (
            <CheckRow key={c.label} ok={c.ok} label={c.label} />
          ))}
        </div>
        {allOk && !production ? (
          <button
            type="button"
            onClick={() => setConfirmProd(true)}
            className="mt-4 min-h-[48px] px-5 rounded-lg text-[13px] font-semibold text-white inline-flex items-center gap-2"
            style={{ background: "var(--sa-success)" }}
          >
            <Check size={16} />
            Activer la production paiement
          </button>
        ) : production ? (
          <p className="mt-4 text-[13px] font-semibold" style={{ color: "var(--sa-success)" }}>
            Production paiement active
          </p>
        ) : (
          <div className="mt-4">
            <button type="button" disabled className="min-h-[48px] px-5 rounded-lg text-[13px] font-semibold text-white opacity-50" style={{ background: "var(--sa-success)" }}>
              Activer la production paiement
            </button>
            <p className="mt-2 text-[12px] font-medium" style={{ color: "var(--sa-danger)" }}>
              Complétez les 4 blocs avant d'activer
            </p>
          </div>
        )}
      </section>

      <section className="rounded-xl" style={{ background: "var(--sa-surface)", boxShadow: "var(--sa-shadow)" }}>
        <button type="button" onClick={() => setHistOpen(!histOpen)} className="w-full flex items-center justify-between px-5 py-4 text-left">
          <span className="text-[14px] font-semibold" style={{ color: "var(--sa-text)" }}>Historique des modifications du contrat</span>
          <span className="text-[12px]" style={{ color: "var(--sa-muted)" }}>{histOpen ? "Masquer" : "Afficher"}</span>
        </button>
        {histOpen ? (
          <div className="px-5 pb-4 space-y-2">
            {(contrat.avenants || []).length === 0 ? (
              <p className="text-[13px]" style={{ color: "var(--sa-muted)" }}>Aucun avenant pour l’instant.</p>
            ) : (
              contrat.avenants.map((a, i) => (
                <div key={`${a.at}-${i}`} className="rounded-lg p-3 text-[12px]" style={{ background: "var(--sa-surface-2)" }}>
                  <p className="font-medium" style={{ color: "var(--sa-text)" }}>
                    {new Date(a.at).toLocaleString("fr-FR")} · {a.par} · {a.bloc}
                  </p>
                  <p style={{ color: "var(--sa-muted)" }}>
                    {a.avant} → {a.apres}
                  </p>
                </div>
              ))
            )}
          </div>
        ) : null}
      </section>

      <ConfirmationModal
        ouvert={confirmProd}
        titre="Activer la production paiement"
        texte="Ce terrain sera actif en production PayTech. Les joueurs pourront payer l'avance en ligne."
        labelConfirmer="Confirmer"
        variante="success"
        onConfirmer={activerProduction}
        onAnnuler={() => setConfirmProd(false)}
      />
      <ConfirmationModal
        ouvert={Boolean(confirmVerif)}
        titre="Marquer comme vérifié"
        texte="Le gérant a confirmé la réception ?"
        labelConfirmer="Oui, vérifier"
        variante="success"
        onConfirmer={() => confirmVerif && marquerVerifie(confirmVerif)}
        onAnnuler={() => setConfirmVerif(null)}
      />
    </div>
  );
}
