import { useEffect, useState } from "react";
import { ArrowDownToLine, Banknote, CalendarDays, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { gerantApi } from "@/lib/api";

type LigneDu = {
  id?: number;
  reservation_id?: number;
  code_reservation?: string;
  date?: string;
  joueur_nom?: string;
  avance?: number;
  commission?: number;
  frais?: number;
  net?: number;
  statut?: string;
  statut_label?: string;
};

type PortefeuilleData = {
  payout_mode?: "auto" | "retrait";
  formule?: string;
  label?: string;
  solde_disponible: number;
  solde_en_fenetre?: number;
  solde_demande_retrait?: number;
  solde_net_apres_dette?: number;
  dette_commission_ouverte?: number;
  dette_nb?: number;
  total_verse?: number;
  total_encaisse?: number;
  total_avances?: number;
  total_commission?: number;
  total_commission_prelevee?: number;
  total_frais_gerant?: number;
  bouton_retirer?: boolean;
  lignes?: LigneDu[];
  historique_reversements?: Array<{ reservation_id?: number; montant?: number; date?: string; statut?: string }>;
  historique_payouts?: Array<{
    id?: number;
    montant_net?: number;
    montant_dette_compensee?: number;
    statut?: string;
    statut_label?: string;
    motif_rejet?: string;
    motif_lisible?: string;
    created_at?: string;
    envoye_at?: string;
    type?: string;
    ref_paytech?: string;
  }>;
  contrat?: {
    payout_mode?: string;
    canal_verifie?: boolean;
    wave_numero?: string;
    om_numero?: string;
    texte_auto?: string | null;
  };
};

type DettesData = {
  resume?: {
    dette_en_cours?: number;
    dette_payee?: number;
    total_dette?: number;
    nb_reservations_manuelles?: number;
  };
  detail?: Array<{
    id?: number;
    montant_commission?: number;
    statut?: string;
    code_reservation?: string;
    match_date?: string;
    joueur_nom?: string;
  }>;
  instructions?: string;
  periode?: string;
};

type ContratLecture = {
  payout_mode?: string;
  pourcentage_avance?: number;
  commission_pourcentage?: number;
  remboursement_autorise?: number;
  delai_remboursement_heures?: number;
  wave_numero?: string;
  om_numero?: string;
  numeros_identiques_whatsapp?: number;
  canal_verifie?: boolean;
  preview?: { auto?: { du_gerant?: number }; retrait?: { du_gerant?: number } };
};

type TarifsLite = {
  prix_entier_base?: number;
  prix_moitie_base?: number;
  pourcentage_avance?: number;
};

function formatFcfa(value?: number) {
  return `${Number(value || 0).toLocaleString("fr-FR")} FCFA`;
}

function formatDate(value?: string) {
  if (!value) return "—";
  const raw = String(value).trim();
  const date = new Date(raw.includes("T") ? raw : raw.replace(" ", "T"));
  if (Number.isNaN(date.getTime())) return raw;
  return date.toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function statutColor(statut?: string) {
  if (statut === "verse") return "var(--g-libre)";
  if (statut === "demande_retrait") return "var(--g-info)";
  if (statut === "en_fenetre") return "var(--g-accent)";
  if (statut === "echec") return "var(--g-danger)";
  return "var(--g-text)";
}

export default function FinancesPage() {
  const [data, setData] = useState<PortefeuilleData | null>(null);
  const [contrat, setContrat] = useState<ContratLecture | null>(null);
  const [tarifs, setTarifs] = useState<TarifsLite | null>(null);
  const [dettes, setDettes] = useState<DettesData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retiring, setRetiring] = useState(false);
  const [confirmRetrait, setConfirmRetrait] = useState(false);
  const [waveDemande, setWaveDemande] = useState("");
  const [omDemande, setOmDemande] = useState("");
  const [memeWhatsapp, setMemeWhatsapp] = useState(false);
  const [motifNumero, setMotifNumero] = useState("");
  const [sendingNumero, setSendingNumero] = useState(false);

  const reload = () =>
    Promise.all([
      gerantApi.portefeuille(),
      gerantApi.contrat().catch(() => null),
      gerantApi.getTarifs(),
      gerantApi.dettes().catch(() => null),
    ]).then(([portefeuille, contratLecture, grille, dettesPayload]) => {
      setData(portefeuille as PortefeuilleData);
      setContrat(contratLecture as ContratLecture | null);
      setTarifs(grille as TarifsLite);
      setDettes(dettesPayload as DettesData | null);
    });

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    reload()
      .catch((err) => {
        if (!mounted) return;
        setError(err instanceof Error ? err.message : "Impossible de charger les gains");
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  if (loading) {
    return (
      <div className="p-4 space-y-4 animate-pulse">
        <div className="h-36 rounded-2xl" style={{ background: "var(--g-surface-2)" }} />
        <div className="grid grid-cols-3 gap-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-24 rounded-xl" style={{ background: "var(--g-surface-2)" }} />
          ))}
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-4">
        <p className="text-sm" style={{ color: "var(--g-danger)" }}>
          {error || "Mes gains indisponibles"}
        </p>
      </div>
    );
  }

  const mode = data.payout_mode === "auto" ? "auto" : "retrait";
  const lignes = data.lignes || [];
  const avances = Number(data.total_avances ?? data.total_encaisse ?? 0);
  const commission = Number(data.total_commission ?? data.total_commission_prelevee ?? 0);
  const wave = contrat?.wave_numero || data.contrat?.wave_numero || "—";
  const om = contrat?.om_numero || data.contrat?.om_numero || "—";
  const detteOuverte = Number(data.dette_commission_ouverte ?? dettes?.resume?.dette_en_cours ?? 0);
  const soldeNet = Number(
    data.solde_net_apres_dette != null
      ? data.solde_net_apres_dette
      : Math.max(0, Number(data.solde_disponible || 0) - detteOuverte),
  );
  const payouts = data.historique_payouts || [];

  const retirer = async () => {
    if (retiring) return;
    if (!(Number(data.solde_disponible) > 0) && !(detteOuverte > 0)) {
      toast.error("Aucun montant disponible au retrait");
      return;
    }
    setRetiring(true);
    try {
      const result = (await gerantApi.retirer()) as {
        montant?: number;
        montant_dette_compensee?: number;
        montant_brut?: number;
      };
      const detteMsg = Number(result.montant_dette_compensee) > 0
        ? ` (dette commission ${formatFcfa(result.montant_dette_compensee)} déduite)`
        : "";
      toast.success(`Demande de versement envoyée — ${formatFcfa(result.montant)}${detteMsg}`);
      setConfirmRetrait(false);
      await reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Retrait impossible");
    } finally {
      setRetiring(false);
    }
  };

  const envoyerDemandeNumero = async () => {
    setSendingNumero(true);
    try {
      await gerantApi.demandeChangementNumero({
        wave_numero: waveDemande,
        om_numero: omDemande,
        numeros_identiques_whatsapp: memeWhatsapp,
        motif: motifNumero,
      });
      toast.success("Demande envoyée au superadmin");
      setWaveDemande("");
      setOmDemande("");
      setMotifNumero("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Demande impossible");
    } finally {
      setSendingNumero(false);
    }
  };

  return (
    <div className="p-4 space-y-6">
      <section
        className="rounded-2xl p-5 text-white"
        style={{ background: "var(--g-primary)", boxShadow: "var(--g-shadow-md)" }}
      >
        <p className="text-sm text-white/85">{data.label || "Ton solde"}</p>
        <p className="mt-2 text-4xl font-bold tracking-tight" style={{ fontFamily: "var(--font-display)" }}>
          {formatFcfa(mode === "auto" ? data.total_verse : soldeNet)}
        </p>
        <p className="mt-1 text-xs text-white/75">
          Formule : {data.formule || (mode === "auto" ? "avance − commission − frais" : "avance − commission")}
          {detteOuverte > 0 && mode === "retrait" ? ` − dette ${formatFcfa(detteOuverte)}` : ""}
        </p>
        {mode === "retrait" ? (
          <>
            <button
              type="button"
              disabled={!data.bouton_retirer || retiring || Boolean(data.solde_demande_retrait)}
              onClick={() => setConfirmRetrait(true)}
              className="mt-4 min-h-[44px] px-4 rounded-xl text-sm font-semibold border border-white/70 disabled:opacity-50"
            >
              {data.solde_demande_retrait ? "Demande déjà envoyée" : retiring ? "Envoi…" : "Retirer"}
            </button>
            {!data.contrat?.canal_verifie ? (
              <p className="mt-2 text-xs text-white/80">
                Aucun Wave/OM vérifié : le dû s’accumule, le retrait ne pourra pas aboutir tant que le superadmin n’a pas validé tes numéros.
              </p>
            ) : null}
          </>
        ) : (
          <p className="mt-4 text-xs text-white/80">
            {data.contrat?.texte_auto ||
              "Reversé automatiquement après le délai de remboursement de ton terrain (souvent tout de suite s’il n’y a pas de remboursement). Frais selon le contrat."}
          </p>
        )}
        {Number(data.solde_en_fenetre) > 0 ? (
          <p className="mt-3 text-xs text-white/75">Encore en fenêtre de remboursement : {formatFcfa(data.solde_en_fenetre)}</p>
        ) : null}
        {detteOuverte > 0 ? (
          <p className="mt-2 text-xs text-white/90">
            Dette commission ouverte : {formatFcfa(detteOuverte)} — déduite automatiquement au prochain versement
          </p>
        ) : null}
      </section>

      {confirmRetrait ? (
        <div className="rounded-xl p-4 space-y-3" style={{ background: "var(--g-surface)", boxShadow: "var(--g-shadow)" }}>
          <p className="text-sm font-semibold" style={{ color: "var(--g-text)" }}>Confirmer le versement</p>
          <p className="text-sm" style={{ color: "var(--g-text-2)" }}>
            Solde brut : <strong>{formatFcfa(data.solde_disponible)}</strong>
          </p>
          {detteOuverte > 0 ? (
            <p className="text-sm" style={{ color: "var(--g-text-2)" }}>
              Dette commission déduite : <strong>{formatFcfa(Math.min(detteOuverte, Number(data.solde_disponible || 0)))}</strong>
            </p>
          ) : null}
          <p className="text-sm" style={{ color: "var(--g-text-2)" }}>
            Net à recevoir : <strong>{formatFcfa(soldeNet)}</strong>
          </p>
          <p className="text-xs" style={{ color: "var(--g-muted)" }}>Wave : {wave} · OM : {om}</p>
          <p className="text-xs" style={{ color: "var(--g-muted)" }}>
            Le superadmin valide le versement via l’API prestataire. Double validation requise — un seul envoi possible.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={retiring}
              onClick={retirer}
              className="flex-1 min-h-[44px] rounded-xl text-sm font-semibold text-white disabled:opacity-60"
              style={{ background: "var(--g-primary)" }}
            >
              {retiring ? "Envoi…" : "Confirmer"}
            </button>
            <button
              type="button"
              disabled={retiring}
              onClick={() => setConfirmRetrait(false)}
              className="flex-1 min-h-[44px] rounded-xl text-sm font-semibold disabled:opacity-60"
              style={{ border: "1px solid var(--g-border)", color: "var(--g-text)" }}
            >
              Annuler
            </button>
          </div>
        </div>
      ) : null}

      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-xl p-3" style={{ background: "var(--g-surface)", boxShadow: "var(--g-shadow)" }}>
          <Banknote className="w-4 h-4 mb-2" style={{ color: "var(--g-primary)" }} />
          <p className="text-lg font-bold leading-tight" style={{ fontFamily: "var(--font-display)", color: "var(--g-text)" }}>
            {formatFcfa(avances)}
          </p>
          <p className="text-[11px] mt-1" style={{ color: "var(--g-muted)" }}>Avances brutes</p>
        </div>
        <div className="rounded-xl p-3" style={{ background: "var(--g-surface)", boxShadow: "var(--g-shadow)" }}>
          <CalendarDays className="w-4 h-4 mb-2" style={{ color: "var(--g-info)" }} />
          <p className="text-lg font-bold leading-tight" style={{ fontFamily: "var(--font-display)", color: "var(--g-text)" }}>
            {formatFcfa(commission)}
          </p>
          <p className="text-[11px] mt-1" style={{ color: "var(--g-muted)" }}>Commission TerrainSN</p>
        </div>
        <div className="rounded-xl p-3" style={{ background: "var(--g-surface)", boxShadow: "var(--g-shadow)" }}>
          <ArrowDownToLine className="w-4 h-4 mb-2" style={{ color: "var(--g-accent)" }} />
          <p className="text-lg font-bold leading-tight" style={{ fontFamily: "var(--font-display)", color: "var(--g-text)" }}>
            {formatFcfa(data.total_frais_gerant)}
          </p>
          <p className="text-[11px] mt-1" style={{ color: "var(--g-muted)" }}>
            {mode === "retrait" ? "Frais payout (0)" : "Frais à ta charge"}
          </p>
        </div>
      </div>

      <section>
        <h2 className="text-sm font-semibold mb-3" style={{ color: "var(--g-text)" }}>
          Détail par réservation
        </h2>
        {lignes.length === 0 ? (
          <p className="text-sm text-center py-8 rounded-xl" style={{ color: "var(--g-muted)", background: "var(--g-surface)" }}>
            Aucune avance pour le moment
          </p>
        ) : (
          <ul className="space-y-2">
            {lignes.map((item, index) => (
              <li
                key={`${item.id || item.reservation_id || "r"}-${item.date || index}`}
                className="rounded-xl p-3"
                style={{ background: "var(--g-surface)", boxShadow: "var(--g-shadow)" }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs" style={{ color: "var(--g-muted)" }}>
                      {formatDate(item.date)} · {item.code_reservation || `#${item.reservation_id || "—"}`}
                    </p>
                    <p className="text-xs mt-0.5" style={{ color: "var(--g-text-2)" }}>{item.joueur_nom || "Joueur"}</p>
                    <p className="text-[11px] mt-1" style={{ color: "var(--g-muted)" }}>
                      Avance {formatFcfa(item.avance)} − com. {formatFcfa(item.commission)}
                      {Number(item.frais) > 0 ? ` − frais ${formatFcfa(item.frais)}` : ""}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold" style={{ color: statutColor(item.statut) }}>
                      {formatFcfa(item.net)}
                    </p>
                    <p className="text-[11px] mt-0.5" style={{ color: "var(--g-muted)" }}>
                      {item.statut_label || item.statut}
                    </p>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {detteOuverte > 0 || (dettes?.detail && dettes.detail.length > 0) ? (
        <section>
          <h2 className="text-sm font-semibold mb-3" style={{ color: "var(--g-text)" }}>
            Dettes commission (confirmations manuelles)
          </h2>
          <div className="rounded-xl p-4 space-y-3" style={{ background: "var(--g-surface)", boxShadow: "var(--g-shadow)" }}>
            <p className="text-sm" style={{ color: "var(--g-text)" }}>
              En cours : <strong>{formatFcfa(detteOuverte)}</strong>
              {dettes?.periode ? ` · période ${dettes.periode}` : ""}
            </p>
            {dettes?.instructions ? (
              <p className="text-xs" style={{ color: "var(--g-muted)" }}>{dettes.instructions}</p>
            ) : (
              <p className="text-xs" style={{ color: "var(--g-muted)" }}>
                Ces commissions sont déduites automatiquement de tes prochains reversements Wave/OM.
              </p>
            )}
            <ul className="space-y-2">
              {(dettes?.detail || []).filter((d) => d.statut === "en_attente").slice(0, 8).map((d) => (
                <li key={d.id} className="flex justify-between text-xs" style={{ color: "var(--g-text-2)" }}>
                  <span>{d.code_reservation || "Résa"} · {d.joueur_nom || "—"}</span>
                  <span style={{ color: "var(--g-danger)" }}>{formatFcfa(d.montant_commission)}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>
      ) : null}

      {payouts.length > 0 ? (
        <section>
          <h2 className="text-sm font-semibold mb-3" style={{ color: "var(--g-text)" }}>
            Historique des versements
          </h2>
          <ul className="space-y-2">
            {payouts.slice(0, 20).map((p) => (
              <li
                key={p.id}
                className="rounded-xl p-3 flex items-start justify-between gap-3"
                style={{ background: "var(--g-surface)", boxShadow: "var(--g-shadow)" }}
              >
                <div>
                  <p className="text-xs" style={{ color: "var(--g-muted)" }}>
                    {formatDate(p.envoye_at || p.created_at)} · {p.type || "payout"}
                  </p>
                  <p className="text-[11px] mt-1" style={{ color: statutColor(p.statut === "envoye" ? "verse" : p.statut === "echec" ? "echec" : "demande_retrait") }}>
                    {p.statut_label || p.statut}
                  </p>
                  {p.motif_rejet || p.motif_lisible ? (
                    <p className="text-[11px] mt-1" style={{ color: "var(--g-danger)" }}>
                      {p.motif_lisible || p.motif_rejet}
                    </p>
                  ) : null}
                  {Number(p.montant_dette_compensee) > 0 ? (
                    <p className="text-[11px] mt-0.5" style={{ color: "var(--g-muted)" }}>
                      dont dette {formatFcfa(p.montant_dette_compensee)}
                    </p>
                  ) : null}
                </div>
                <p className="text-sm font-bold" style={{ color: "var(--g-text)" }}>
                  {formatFcfa(p.montant_net)}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section>
        <h2 className="text-sm font-semibold mb-3" style={{ color: "var(--g-text)" }}>
          Contrat (lecture seule)
        </h2>
        <div className="rounded-xl p-4 space-y-2" style={{ background: "var(--g-surface)", boxShadow: "var(--g-shadow)" }}>
          <p className="text-sm" style={{ color: "var(--g-text)" }}>
            Mode : <strong>{mode === "auto" ? "Reversement automatique (avec frais)" : "Retrait à la demande (0 frais)"}</strong>
          </p>
          <p className="text-xs" style={{ color: "var(--g-muted)" }}>
            Avance {Number(contrat?.pourcentage_avance || tarifs?.pourcentage_avance || 0)}% · Commission {Number(contrat?.commission_pourcentage || 0)}%
          </p>
          <p className="text-xs" style={{ color: "var(--g-muted)" }}>
            {Number(contrat?.remboursement_autorise) === 1
              ? `Remboursement possible dans les ${contrat?.delai_remboursement_heures || 0} h`
              : "Annulation sans remboursement"}
          </p>
          <p className="text-xs" style={{ color: "var(--g-muted)" }}>
            Wave {wave} · OM {om}
            {data.contrat?.canal_verifie ? " · vérifiés" : " · en attente de vérif. superadmin"}
          </p>
          {Number(contrat?.numeros_identiques_whatsapp) === 1 ? (
            <p className="text-xs inline-flex items-center gap-1" style={{ color: "var(--g-muted)" }}>
              <ShieldCheck className="w-3.5 h-3.5" /> C’est le même numéro que WhatsApp
            </p>
          ) : null}
        </div>
      </section>

      <section>
        <h2 className="text-sm font-semibold mb-3" style={{ color: "var(--g-text)" }}>
          Demander un changement de numéro
        </h2>
        <div className="rounded-xl p-4 space-y-3" style={{ background: "var(--g-surface)", boxShadow: "var(--g-shadow)" }}>
          <p className="text-xs" style={{ color: "var(--g-muted)" }}>
            Le superadmin valide. Tu ne modifies pas Wave/OM tout seul.
          </p>
          <label className="flex items-center gap-2 text-sm" style={{ color: "var(--g-text)" }}>
            <input type="checkbox" checked={memeWhatsapp} onChange={(e) => setMemeWhatsapp(e.target.checked)} />
            Utiliser mon WhatsApp pour Wave et OM
          </label>
          {!memeWhatsapp ? (
            <>
              <input
                value={waveDemande}
                onChange={(e) => setWaveDemande(e.target.value)}
                placeholder="Nouveau Wave"
                className="w-full h-11 px-3 rounded-lg border text-sm"
                style={{ borderColor: "var(--g-border)", background: "var(--g-surface-2)" }}
              />
              <input
                value={omDemande}
                onChange={(e) => setOmDemande(e.target.value)}
                placeholder="Nouveau Orange Money"
                className="w-full h-11 px-3 rounded-lg border text-sm"
                style={{ borderColor: "var(--g-border)", background: "var(--g-surface-2)" }}
              />
            </>
          ) : null}
          <input
            value={motifNumero}
            onChange={(e) => setMotifNumero(e.target.value)}
            placeholder="Motif (optionnel)"
            className="w-full h-11 px-3 rounded-lg border text-sm"
            style={{ borderColor: "var(--g-border)", background: "var(--g-surface-2)" }}
          />
          <button
            type="button"
            disabled={sendingNumero}
            onClick={envoyerDemandeNumero}
            className="w-full min-h-[44px] rounded-xl text-sm font-semibold text-white disabled:opacity-60"
            style={{ background: "var(--g-primary)" }}
          >
            {sendingNumero ? "Envoi…" : "Envoyer la demande"}
          </button>
        </div>
      </section>

      <section>
        <h2 className="text-sm font-semibold mb-3" style={{ color: "var(--g-text)" }}>
          Prix de ton terrain (visibles côté joueur)
        </h2>
        <TarifsEditor initial={tarifs} onSaved={setTarifs} />
      </section>
    </div>
  );
}

function TarifsEditor({
  initial,
  onSaved,
}: {
  initial: TarifsLite | null;
  onSaved: (t: TarifsLite) => void;
}) {
  const [entier, setEntier] = useState(String(initial?.prix_entier_base || ""));
  const [moitie, setMoitie] = useState(String(initial?.prix_moitie_base || ""));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setEntier(String(initial?.prix_entier_base || ""));
    setMoitie(String(initial?.prix_moitie_base || ""));
  }, [initial?.prix_entier_base, initial?.prix_moitie_base]);

  const save = async () => {
    const prix_entier_base = Number(entier);
    const prix_moitie_base = Number(moitie);
    if (!(prix_entier_base > 0) || !(prix_moitie_base > 0)) {
      toast.error("Tarifs invalides");
      return;
    }
    setSaving(true);
    try {
      const grille = (await gerantApi.saveTarifs({
        prix_entier_base,
        prix_moitie_base,
        cellules: [],
      })) as TarifsLite;
      onSaved(grille);
      toast.success("Tarifs mis à jour — le joueur voit les nouveaux prix");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Sauvegarde impossible");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-xl p-4 space-y-3" style={{ background: "var(--g-surface)", boxShadow: "var(--g-shadow)" }}>
      <label className="block text-sm" style={{ color: "var(--g-text)" }}>
        Terrain entier (FCFA / h)
        <input
          type="number"
          value={entier}
          onChange={(e) => setEntier(e.target.value)}
          className="mt-1 w-full h-11 px-3 rounded-lg border text-sm"
          style={{ borderColor: "var(--g-border)", background: "var(--g-surface-2)" }}
        />
      </label>
      <label className="block text-sm" style={{ color: "var(--g-text)" }}>
        Demi-terrain (FCFA / h)
        <input
          type="number"
          value={moitie}
          onChange={(e) => setMoitie(e.target.value)}
          className="mt-1 w-full h-11 px-3 rounded-lg border text-sm"
          style={{ borderColor: "var(--g-border)", background: "var(--g-surface-2)" }}
        />
      </label>
      <p className="text-sm" style={{ color: "var(--g-text)" }}>
        Avance joueur : <strong>{Number(initial?.pourcentage_avance || 0)}%</strong> du prix
        <span className="block text-xs mt-1" style={{ color: "var(--g-muted)" }}>
          Figé par le contrat superadmin — tu ne peux pas le modifier.
        </span>
      </p>
      <button
        type="button"
        disabled={saving}
        onClick={save}
        className="w-full min-h-[44px] rounded-xl text-sm font-semibold text-white disabled:opacity-60"
        style={{ background: "var(--g-primary)" }}
      >
        {saving ? "Enregistrement…" : "Enregistrer les tarifs"}
      </button>
    </div>
  );
}
