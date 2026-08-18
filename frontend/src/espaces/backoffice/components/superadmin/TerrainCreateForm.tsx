import { FormEvent, useMemo, useState } from "react";
import { ArrowRightLeft, DollarSign, Hand, Loader2, RefreshCw, Smartphone, Zap } from "lucide-react";
import { toast } from "sonner";
import CommoditesPicker from "@/components/CommoditesPicker";
import type { CommoditeId } from "@/lib/commodites";
import PctMontantPair, { montantDepuisPct } from "@/components/PctMontantPair";
import Select2 from "@/components/Select2";
import GrilleTarifaireForm, {
  emptyGrilleValues,
  type GrilleValues,
} from "@/espaces/backoffice/components/GrilleTarifaireForm";
import PreviewContrat from "@/espaces/backoffice/components/superadmin/PreviewContrat";
import { superAdminApi } from "@/services/superAdminApi";
import {
  type CanalReversement,
  type FraisPolitique,
  type PayoutMode,
  digitsSn,
  formatTelAffichage,
  saveContratOverlay,
  statutCanalDepuisNumero,
  texteAnnulationJoueur,
  texteImpactReversement,
} from "@/lib/saContrat";

type Props = {
  owners: any[];
  gerants: any[];
  auteur: string;
  onCreated: () => Promise<void> | void;
  onCancel: () => void;
};

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-[12px] font-medium" style={{ color: "var(--sa-text-2)" }}>
        {label}
      </span>
      <div className="mt-1">{children}</div>
      {hint ? (
        <span className="mt-1 block text-[11px]" style={{ color: "var(--sa-muted)" }}>
          {hint}
        </span>
      ) : null}
    </label>
  );
}

const inputClass = "w-full h-11 rounded-lg px-3 text-sm";
const inputStyle = {
  border: "1px solid var(--sa-border)",
  background: "var(--sa-surface)",
  color: "var(--sa-text)",
};

function Pill({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="px-3 min-h-[36px] rounded-full text-[12px] font-semibold"
      style={{
        background: active ? "var(--sa-primary)" : "var(--sa-surface)",
        color: active ? "var(--sa-surface)" : "var(--sa-text-2)",
        border: active ? "1px solid var(--sa-primary)" : "1px solid var(--sa-border)",
      }}
    >
      {children}
    </button>
  );
}

export default function TerrainCreateForm({ owners, gerants, auteur, onCreated, onCancel }: Props) {
  const [saving, setSaving] = useState(false);
  const [nom, setNom] = useState("");
  const [quartier, setQuartier] = useState("");
  const [ville, setVille] = useState("Dakar");
  const [surface, setSurface] = useState("gazon_synthetique");
  const [taille, setTaille] = useState("11v11");
  const [proprietaireId, setProprietaireId] = useState("");
  const [gerantId, setGerantId] = useState("");
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  const [commodites, setCommodites] = useState<CommoditeId[]>([]);
  const [grille, setGrille] = useState<GrilleValues>(emptyGrilleValues({ entier: 40000, demi: 24000 }));

  const [pctAvance, setPctAvance] = useState("12.5");
  const [pctCommission, setPctCommission] = useState("10");

  const [sameWhatsapp, setSameWhatsapp] = useState(false);
  const [wave, setWave] = useState("");
  const [om, setOm] = useState("");
  const [canal, setCanal] = useState<CanalReversement>("les_deux");

  const [remb, setRemb] = useState(false);
  const [delai, setDelai] = useState("24");

  const [mode, setMode] = useState<PayoutMode>("retrait");
  const [politique, setPolitique] = useState<FraisPolitique>("partage");
  const [pctG, setPctG] = useState("1");
  const [pctP, setPctP] = useState("1");

  const gerant = gerants.find((g) => String(g.id) === gerantId) || null;
  const whatsapp = gerant?.telephone || gerant?.whatsapp_number || "";

  const prixRef = useMemo(() => {
    return Number(grille.semaine.apres.entier || grille.semaine.avant.entier || 40000);
  }, [grille]);
  const avanceMontant = montantDepuisPct(Number(pctAvance) || 0, prixRef);
  const commissionMontant = montantDepuisPct(Number(pctCommission) || 0, avanceMontant);
  const baseGerant = Math.max(0, avanceMontant - commissionMontant);

  const lockNumeros = sameWhatsapp && Boolean(whatsapp);

  function applySameWhatsapp(checked: boolean) {
    setSameWhatsapp(checked);
    if (checked && whatsapp) {
      const formatted = formatTelAffichage(whatsapp);
      setWave(formatted);
      setOm(formatted);
    }
  }

  function grilleIncomplete(g: GrilleValues) {
    const prices = [
      g.semaine.avant.demi,
      g.semaine.avant.entier,
      g.semaine.apres.demi,
      g.semaine.apres.entier,
      g.weekend.avant.demi,
      g.weekend.avant.entier,
      g.weekend.apres.demi,
      g.weekend.apres.entier,
    ];
    return prices.some((p) => !(Number(p) > 0));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const entier = Number(grille.semaine.apres.entier || grille.semaine.avant.entier || 0);
    const demi = Number(grille.semaine.apres.demi || grille.semaine.avant.demi || Math.round(entier * 0.6));
    if (!nom.trim() || !proprietaireId) {
      toast.error("Nom et propriétaire sont requis");
      return;
    }
    if (grilleIncomplete(grille)) {
      toast.error("Tous les tarifs de la grille (semaine et week-end, demi et entier) doivent être positifs");
      return;
    }
    setSaving(true);
    try {
      const created = await superAdminApi.createTerrain({
        nom: nom.trim(),
        quartier,
        ville,
        surface,
        taille,
        prix_heure: entier,
        prix_entier: entier,
        prix_moitie: demi,
        pourcentage_avance: Number(pctAvance || 0),
        modele_revenus: "commission",
        commission_pourcentage: Number(pctCommission || 0),
        delai_remboursement_heures: remb ? Number(delai || 0) : 0,
        latitude: latitude ? Number(latitude) : null,
        longitude: longitude ? Number(longitude) : null,
        proprietaire_id: Number(proprietaireId),
        commodites,
        photos: [],
      });
      const terrainId = Number(created?.id);
      if (terrainId) {
        try {
          await superAdminApi.saveGrilleTarifs(terrainId, grille);
        } catch (err) {
          toast.error(err instanceof Error ? err.message : "Grille tarifaire non enregistrée");
        }
        try {
          await superAdminApi.updateTarifs(terrainId, {
            pourcentage_avance: Number(pctAvance || 0),
            commission_pourcentage: Number(pctCommission || 0),
          });
        } catch {
          /* déjà envoyé à la création */
        }
        try {
          await superAdminApi.politiqueAnnulation(terrainId, remb ? Number(delai || 0) : 0);
        } catch {
          /* déjà envoyé à la création */
        }
        const w = formatTelAffichage(wave);
        const o = formatTelAffichage(om);
        saveContratOverlay(
          terrainId,
          {
            wave_numero: w,
            om_numero: o,
            numeros_identiques_whatsapp: sameWhatsapp,
            canal_reversement: canal,
            wave_statut: statutCanalDepuisNumero(w),
            om_statut: statutCanalDepuisNumero(o),
            remboursement_autorise: remb && Number(delai) > 0,
            payout_mode: mode,
            payout_frais_politique: politique,
            frais_payout_pct_gerant: Number(pctG) || 0,
            frais_payout_pct_plateforme: Number(pctP) || 0,
          },
          {
            par: auteur,
            bloc: "Création terrain",
            avant: "—",
            apres: `Avance ${pctAvance}% · Com. ${pctCommission}% · ${mode}`,
          },
        );
      }
      toast.success("Terrain créé avec contrat et grille tarifaire");
      await onCreated();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Création impossible");
    } finally {
      setSaving(false);
    }
  }

  const twoNumbers = Boolean(digitsSn(wave) && digitsSn(om));

  return (
    <form onSubmit={submit} className="space-y-5">
      <section className="rounded-xl p-5" style={{ background: "var(--sa-surface)", boxShadow: "var(--sa-shadow)", borderTop: "3px solid var(--sa-primary)" }}>
        <h3 className="text-[15px] font-semibold" style={{ color: "var(--sa-text)" }}>Identité du terrain</h3>
        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Nom">
            <input className={inputClass} style={inputStyle} value={nom} onChange={(e) => setNom(e.target.value)} required />
          </Field>
          <Field label="Quartier">
            <input className={inputClass} style={inputStyle} value={quartier} onChange={(e) => setQuartier(e.target.value)} />
          </Field>
          <Field label="Ville">
            <input className={inputClass} style={inputStyle} value={ville} onChange={(e) => setVille(e.target.value)} />
          </Field>
          <Field label="Taille">
            <Select2
              value={taille}
              onChange={setTaille}
              options={[
                { value: "5v5", label: "5v5" },
                { value: "7v7", label: "7v7" },
                { value: "11v11", label: "11v11" },
              ]}
            />
          </Field>
          <Field label="Surface">
            <Select2
              value={surface}
              onChange={setSurface}
              options={[
                { value: "gazon_naturel", label: "Gazon naturel" },
                { value: "gazon_synthetique", label: "Gazon synthétique" },
                { value: "beton", label: "Béton" },
              ]}
            />
          </Field>
          <Field label="Propriétaire">
            <Select2
              value={proprietaireId}
              onChange={setProprietaireId}
              required
              placeholder="Choisir"
              options={owners.map((o) => ({ value: String(o.id), label: o.nom }))}
            />
          </Field>
          <Field label="Gérant (référence WhatsApp)" hint="Sert à préremplir Wave / OM. L’affectation compte se fait dans Utilisateurs.">
            <Select2
              value={gerantId}
              placeholder="Aucun / plus tard"
              options={[
                { value: "", label: "Aucun / plus tard" },
                ...gerants.map((g) => ({
                  value: String(g.id),
                  label: `${g.nom}${g.terrain_nom ? ` · ${g.terrain_nom}` : ""}`,
                })),
              ]}
              onChange={(next) => {
                setGerantId(next);
                const g = gerants.find((x) => String(x.id) === next);
                if (sameWhatsapp && g?.telephone) {
                  const formatted = formatTelAffichage(g.telephone);
                  setWave(formatted);
                  setOm(formatted);
                }
              }}
            />
          </Field>
          <Field label="Latitude">
            <input className={inputClass} style={inputStyle} type="number" step="any" value={latitude} onChange={(e) => setLatitude(e.target.value)} />
          </Field>
          <Field label="Longitude">
            <input className={inputClass} style={inputStyle} type="number" step="any" value={longitude} onChange={(e) => setLongitude(e.target.value)} />
          </Field>
          <div className="sm:col-span-2 rounded-lg p-3" style={{ border: "1px solid var(--sa-border)" }}>
            <p className="text-[12px] font-medium mb-2" style={{ color: "var(--sa-text-2)" }}>Commodités</p>
            <CommoditesPicker value={commodites} onChange={setCommodites} />
          </div>
        </div>
      </section>

      <section className="rounded-xl p-5" style={{ background: "var(--sa-surface)", boxShadow: "var(--sa-shadow)", borderTop: "3px solid var(--sa-info)" }}>
        <h3 className="text-[15px] font-semibold" style={{ color: "var(--sa-text)" }}>Grille tarifaire</h3>
        <p className="mt-1 text-[12px]" style={{ color: "var(--sa-muted)" }}>
          Semaine / week-end, avant et après l’heure de soirée — même structure que l’onglet Tarifs.
        </p>
        <div
          className="mt-4"
          style={{
            ["--g-surface" as string]: "var(--sa-surface)",
            ["--g-surface-2" as string]: "var(--sa-surface-2)",
            ["--g-text" as string]: "var(--sa-text)",
            ["--g-text-2" as string]: "var(--sa-text-2)",
            ["--g-muted" as string]: "var(--sa-muted)",
            ["--g-border" as string]: "var(--sa-border)",
          }}
        >
          <GrilleTarifaireForm value={grille} onChange={setGrille} />
        </div>
      </section>

      <section className="rounded-xl p-5" style={{ background: "var(--sa-surface)", boxShadow: "var(--sa-shadow)", borderTop: "3px solid var(--sa-primary)" }}>
        <h3 className="flex items-center gap-2 text-[15px] font-semibold" style={{ color: "var(--sa-text)" }}>
          <DollarSign size={16} style={{ color: "var(--sa-primary)" }} />
          Commercial
        </h3>
        <div className="mt-4 space-y-4">
          <PctMontantPair
            label="Avance joueur"
            labelMontant="Montant avance"
            hint={`Sur un créneau de référence à ${prixRef.toLocaleString("fr-SN")} FCFA`}
            pct={pctAvance}
            onPctChange={setPctAvance}
            base={prixRef}
          />
          <PctMontantPair
            label="Commission TerrainSN"
            labelMontant="Montant commission"
            hint="Prélevée uniquement sur l'avance"
            pct={pctCommission}
            onPctChange={setPctCommission}
            base={avanceMontant}
          />
        </div>
      </section>

      <section className="rounded-xl p-5" style={{ background: "var(--sa-surface)", boxShadow: "var(--sa-shadow)", borderTop: "3px solid var(--sa-wave)" }}>
        <h3 className="flex items-center gap-2 text-[15px] font-semibold" style={{ color: "var(--sa-text)" }}>
          <Smartphone size={16} style={{ color: "var(--sa-wave)" }} />
          Reversement — numéros du gérant
        </h3>
        <p className="mt-2 text-[12px]" style={{ color: "var(--sa-muted)" }}>
          L'argent sera reversé sur ces numéros. Ils appartiennent au gérant, pas au propriétaire.
        </p>
        <div className="mt-3 h-11 rounded-lg px-3 flex items-center text-sm" style={{ border: "1px solid var(--sa-border)", background: "var(--sa-surface-2)", color: "var(--sa-text-2)" }}>
          WhatsApp référence : {whatsapp ? formatTelAffichage(whatsapp) : "Aucun gérant sélectionné"}
        </div>
        <label className="mt-3 flex items-center gap-2 text-[13px]" style={{ color: "var(--sa-text)" }}>
          <input type="checkbox" checked={sameWhatsapp} onChange={(e) => applySameWhatsapp(e.target.checked)} />
          Utiliser le même numéro pour Wave et Orange Money
        </label>
        <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label="Numéro Wave">
            <input
              className={inputClass}
              style={{ ...inputStyle, background: lockNumeros ? "var(--sa-surface-2)" : "var(--sa-surface)" }}
              type="tel"
              placeholder="+221 7X XXX XX XX"
              value={wave}
              disabled={lockNumeros}
              onChange={(e) => {
                setWave(e.target.value);
                if (sameWhatsapp) setOm(e.target.value);
              }}
            />
          </Field>
          <Field label="Numéro Orange Money">
            <input
              className={inputClass}
              style={{ ...inputStyle, background: lockNumeros ? "var(--sa-surface-2)" : "var(--sa-surface)" }}
              type="tel"
              placeholder="+221 7X XXX XX XX"
              value={om}
              disabled={lockNumeros}
              onChange={(e) => {
                setOm(e.target.value);
                if (sameWhatsapp) setWave(e.target.value);
              }}
            />
          </Field>
        </div>
        {twoNumbers ? (
          <div className="mt-3">
            <p className="text-[12px] font-medium mb-2" style={{ color: "var(--sa-text-2)" }}>Canal préféré</p>
            <div className="flex flex-wrap gap-2">
              <Pill active={canal === "wave"} onClick={() => setCanal("wave")}>Wave</Pill>
              <Pill active={canal === "om"} onClick={() => setCanal("om")}>Orange Money</Pill>
              <Pill active={canal === "les_deux"} onClick={() => setCanal("les_deux")}>Les deux (Wave → OM)</Pill>
            </div>
          </div>
        ) : null}
      </section>

      <section className="rounded-xl p-5" style={{ background: "var(--sa-surface)", boxShadow: "var(--sa-shadow)", borderTop: "3px solid var(--sa-warning)" }}>
        <h3 className="flex items-center gap-2 text-[15px] font-semibold" style={{ color: "var(--sa-text)" }}>
          <RefreshCw size={16} style={{ color: "var(--sa-warning)" }} />
          Politique d'annulation
        </h3>
        <div className="mt-4 flex items-center gap-3">
          <button type="button" role="switch" aria-checked={remb} onClick={() => setRemb(!remb)} className="sa-switch">
            <span className="sa-switch-thumb" />
          </button>
          <span className="text-[13px]" style={{ color: "var(--sa-text)" }}>
            {remb ? "Oui — remboursement possible dans le délai" : "Non — le joueur ne peut pas se faire rembourser"}
          </span>
        </div>
        {remb ? (
          <div className="mt-3 max-w-xs">
            <Field label="Délai en heures" hint="Ex : 24 = annulation remboursée dans les 24 h après confirmation">
              <input className={inputClass} style={inputStyle} type="number" min={1} value={delai} onChange={(e) => setDelai(e.target.value)} />
            </Field>
          </div>
        ) : null}
        <div className="mt-3 rounded-lg p-3" style={{ background: "var(--sa-surface-2)" }}>
          <p className="text-[11px] font-medium mb-1" style={{ color: "var(--sa-muted)" }}>Ce que verra le joueur :</p>
          <p className="text-[13px]">{texteAnnulationJoueur(remb, Number(delai) || 0)}</p>
        </div>
        <p className="mt-2 text-[12px]" style={{ color: "var(--sa-muted)" }}>{texteImpactReversement(remb, Number(delai) || 0)}</p>
      </section>

      <section className="rounded-xl p-5" style={{ background: "var(--sa-surface)", boxShadow: "var(--sa-shadow)", borderTop: "3px solid var(--sa-success)" }}>
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
            <p className="mt-2 text-[14px] font-semibold">Reversement automatique</p>
            <p className="mt-1 text-[12px]" style={{ color: "var(--sa-muted)" }}>PayTech envoie le dû. Frais de payout selon la politique.</p>
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
            <p className="mt-2 text-[14px] font-semibold">Retrait à la demande</p>
            <p className="mt-1 text-[12px]" style={{ color: "var(--sa-muted)" }}>Le gérant clique Retirer. Virement manuel, 0 frais.</p>
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
                  base={baseGerant}
                />
                <PctMontantPair
                  label="% Plateforme"
                  labelMontant="Frais plateforme"
                  pct={pctP}
                  onPctChange={setPctP}
                  base={baseGerant}
                />
              </div>
            ) : null}
          </div>
        ) : null}
        <div className="mt-4">
          <PreviewContrat
            prix={prixRef}
            pctAvance={Number(pctAvance) || 0}
            pctCommission={Number(pctCommission) || 0}
            mode={mode}
            politiqueFrais={politique}
            pctFraisGerant={Number(pctG) || 0}
            pctFraisPlateforme={Number(pctP) || 0}
          />
        </div>
      </section>

      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={saving} className="min-h-[48px] px-5 rounded-lg text-[13px] font-semibold text-white inline-flex items-center justify-center gap-2" style={{ background: "var(--sa-primary)" }}>
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
          Créer le terrain
        </button>
        <button type="button" onClick={onCancel} className="min-h-[48px] px-5 rounded-lg text-[13px] font-semibold" style={{ border: "1px solid var(--sa-border)", color: "var(--sa-text-2)" }}>
          Annuler
        </button>
      </div>
    </form>
  );
}
