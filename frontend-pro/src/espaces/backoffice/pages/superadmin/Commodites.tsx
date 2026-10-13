import { FormEvent, useEffect, useMemo, useState } from "react";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { superAdminApi } from "@/services/superAdminApi";
import { useSaCrumbs } from "@/espaces/backoffice/layout/SuperadminLayout";
import { ConfirmationModal } from "@/espaces/backoffice/components/superadmin/ConfirmationModal";
import { LucideByName, isLucideName } from "@/lib/lucideByName";
import { COMMODITES_ICON_SUGGESTIONS, getCommoditeIconName } from "@/constants/commoditesIcons";
import SaPageHeader from "@/espaces/backoffice/components/superadmin/ui/SaPageHeader";
import SaButton from "@/espaces/backoffice/components/superadmin/ui/SaButton";
import { useNavigate } from "react-router-dom";

type Commodite = {
  id: number;
  cle: string;
  label_fr: string;
  icone: string;
  description?: string | null;
  actif: number;
  ordre: number;
  modifiable_gerant?: number;
};

const emptyForm = { cle: "", label_fr: "", icone: "CheckCircle2", description: "", ordre: "10", modifiable_gerant: true };

export default function CommoditesPage() {
  useSaCrumbs([{ label: "Commodités", to: "/backoffice/superadmin/commodites" }]);
  const navigate = useNavigate();
  const [items, setItems] = useState<Commodite[]>([]);
  const [modal, setModal] = useState<null | { mode: "create" | "edit"; item?: Commodite }>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [confirmOff, setConfirmOff] = useState<Commodite | null>(null);

  const load = () => superAdminApi.commodites().then(setItems).catch((err) => toast.error(err.message));

  useEffect(() => {
    load().catch(() => {});
  }, []);

  const iconOk = useMemo(() => !form.icone || isLucideName(form.icone), [form.icone]);

  function openCreate() {
    setForm(emptyForm);
    setModal({ mode: "create" });
  }

  function openEdit(item: Commodite) {
    setForm({
      cle: item.cle,
      label_fr: item.label_fr,
      icone: item.icone,
      description: item.description || "",
      ordre: String(item.ordre ?? 0),
      modifiable_gerant: Number(item.modifiable_gerant) !== 0,
    });
    setModal({ mode: "edit", item });
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!form.label_fr.trim()) {
      toast.error("Le label est obligatoire");
      return;
    }
    if (!iconOk) {
      toast.error(`Icône '${form.icone}' introuvable dans Lucide React`);
      return;
    }
    setSaving(true);
    try {
      if (modal?.mode === "create") {
        await superAdminApi.createCommodite({
          cle: form.cle.trim(),
          label_fr: form.label_fr.trim(),
          icone: form.icone.trim(),
          description: form.description.trim() || null,
          ordre: Number(form.ordre || 0),
          modifiable_gerant: form.modifiable_gerant,
        });
        toast.success("Commodité créée");
      } else if (modal?.item) {
        await superAdminApi.updateCommodite(modal.item.id, {
          label_fr: form.label_fr.trim(),
          icone: form.icone.trim(),
          description: form.description.trim() || null,
          ordre: Number(form.ordre || 0),
          modifiable_gerant: form.modifiable_gerant,
        });
        toast.success("Commodité mise à jour");
      }
      setModal(null);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Enregistrement impossible");
    } finally {
      setSaving(false);
    }
  }

  async function toggleActif(item: Commodite) {
    if (item.actif) {
      setConfirmOff(item);
      return;
    }
    try {
      await superAdminApi.updateCommodite(item.id, { actif: 1 });
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Impossible d'activer");
    }
  }

  return (
    <div className="space-y-5 max-w-[1100px]">
      <SaPageHeader
        titre="Commodités"
        sousTitre="Ces commodités s'affichent sur les fiches terrains côté joueur"
        actions={<SaButton icon={<Plus size={16} />} onClick={openCreate}>Ajouter une commodité</SaButton>}
      />

      <div className="rounded-xl overflow-hidden" style={{ background: "var(--sa-surface)", boxShadow: "var(--sa-shadow)" }}>
        <table className="sa-table">
          <thead>
            <tr>
              <th>Ordre</th>
              <th>Icône</th>
              <th>Clé</th>
              <th>Label</th>
              <th>Gérant</th>
              <th>Statut</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.map((c) => (
              <tr key={c.id}>
                <td>
                  <input
                    type="number"
                    className="w-16 h-9 rounded-md px-2 text-[13px]"
                    style={{ border: "1px solid var(--sa-border)", background: "var(--sa-surface)" }}
                    defaultValue={c.ordre}
                    onBlur={async (e) => {
                      const next = Number(e.target.value);
                      if (next === c.ordre) return;
                      try {
                        await superAdminApi.updateCommodite(c.id, { ordre: next });
                        await load();
                      } catch (err) {
                        toast.error(err instanceof Error ? err.message : "Ordre non enregistré");
                      }
                    }}
                  />
                </td>
                <td>
                  <div className="flex flex-col items-start">
                    <LucideByName name={getCommoditeIconName(c.cle, c.icone)} size={18} style={{ color: "var(--sa-primary)" }} />
                    <span className="text-[11px]" style={{ color: "var(--sa-muted)" }}>{c.icone}</span>
                  </div>
                </td>
                <td className="font-mono text-[12px]" style={{ color: "var(--sa-muted)" }}>{c.cle}</td>
                <td className="text-[13px]" style={{ color: "var(--sa-text)" }}>{c.label_fr}</td>
                <td>
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        await superAdminApi.updateCommodite(c.id, { modifiable_gerant: Number(c.modifiable_gerant) === 0 });
                        await load();
                      } catch (err) {
                        toast.error(err instanceof Error ? err.message : "Mise à jour impossible");
                      }
                    }}
                    className="rounded-full px-2.5 py-1 text-[11px] font-semibold"
                    style={{
                      background: Number(c.modifiable_gerant) === 0 ? "var(--sa-surface-2)" : "var(--sa-success-bg)",
                      color: Number(c.modifiable_gerant) === 0 ? "var(--sa-muted)" : "var(--sa-success)",
                    }}
                  >
                    {Number(c.modifiable_gerant) === 0 ? "Admin seul" : "Modifiable"}
                  </button>
                </td>
                <td>
                  <button type="button" onClick={() => toggleActif(c)} className="rounded-full px-2.5 py-1 text-[11px] font-semibold" style={{ background: c.actif ? "var(--sa-success-bg)" : "var(--sa-surface-2)", color: c.actif ? "var(--sa-success)" : "var(--sa-muted)" }}>
                    {c.actif ? "Actif" : "Inactif"}
                  </button>
                </td>
                <td>
                  <div className="flex gap-2">
                    <button type="button" className="text-[12px] font-semibold" style={{ color: "var(--sa-primary)" }} onClick={() => openEdit(c)}>Modifier</button>
                    <button type="button" className="text-[12px]" style={{ color: "var(--sa-muted)" }} onClick={() => navigate(`/backoffice/superadmin/terrains?commodite=${c.cle}`)}>Voir les terrains</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modal ? (
        <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center px-0 md:px-4">
          <button type="button" className="absolute inset-0" style={{ background: "rgba(10,22,40,0.45)" }} onClick={() => setModal(null)} />
          <form onSubmit={submit} className="relative w-full max-w-md rounded-t-2xl md:rounded-2xl p-5 space-y-3" style={{ background: "var(--sa-surface)", boxShadow: "var(--sa-shadow-md)" }}>
            <h2 className="text-lg font-bold" style={{ color: "var(--sa-text)", fontFamily: "var(--font-display)" }}>
              {modal.mode === "create" ? "Nouvelle commodité" : `Modifier ${modal.item?.label_fr}`}
            </h2>
            {modal.mode === "create" ? (
              <label className="block">
                <span className="text-[12px] font-medium" style={{ color: "var(--sa-text-2)" }}>Clé</span>
                <input className="mt-1 w-full h-11 rounded-lg px-3 text-sm" style={{ border: "1px solid var(--sa-border)" }} value={form.cle} onChange={(e) => setForm({ ...form, cle: e.target.value.toLowerCase() })} placeholder="ex: arbitre" required />
                <span className="mt-1 block text-[11px]" style={{ color: "var(--sa-muted)" }}>Identifiant technique unique, ne peut pas être modifié après création</span>
              </label>
            ) : null}
            <label className="block">
              <span className="text-[12px] font-medium" style={{ color: "var(--sa-text-2)" }}>Label français</span>
              <input className="mt-1 w-full h-11 rounded-lg px-3 text-sm" style={{ border: "1px solid var(--sa-border)" }} value={form.label_fr} onChange={(e) => setForm({ ...form, label_fr: e.target.value })} placeholder="ex: Arbitre disponible" required />
            </label>
            <label className="block">
              <span className="text-[12px] font-medium" style={{ color: "var(--sa-text-2)" }}>Icône Lucide</span>
              <div className="mt-1 flex items-center gap-2">
                <input className="flex-1 h-11 rounded-lg px-3 text-sm" style={{ border: "1px solid var(--sa-border)" }} value={form.icone} onChange={(e) => setForm({ ...form, icone: e.target.value })} placeholder="ex: Flag" />
                <span className="w-11 h-11 grid place-items-center rounded-lg" style={{ background: "var(--sa-surface-2)" }}>
                  <LucideByName name={form.icone} size={20} style={{ color: "var(--sa-primary)" }} />
                </span>
              </div>
              {!iconOk ? (
                <span className="mt-1 block text-[12px]" style={{ color: "var(--sa-danger)" }}>Icône &apos;{form.icone}&apos; introuvable dans Lucide React</span>
              ) : (
                <span className="mt-1 block text-[11px]" style={{ color: "var(--sa-muted)" }}>Nom exact d&apos;une icône Lucide React</span>
              )}
              <div className="mt-2 flex flex-wrap gap-1.5">
                {COMMODITES_ICON_SUGGESTIONS.map((name) => (
                  <button
                    key={name}
                    type="button"
                    onClick={() => setForm({ ...form, icone: name })}
                    className="h-9 px-2 rounded-lg inline-flex items-center gap-1 text-[11px]"
                    style={{
                      background: form.icone === name ? "var(--sa-primary-glow)" : "var(--sa-surface-2)",
                      color: form.icone === name ? "var(--sa-primary)" : "var(--sa-text-2)",
                    }}
                    title={name}
                  >
                    <LucideByName name={name} size={14} />
                    {name}
                  </button>
                ))}
              </div>
            </label>
            <label className="flex items-center gap-2 text-[13px]" style={{ color: "var(--sa-text)" }}>
              <input type="checkbox" checked={form.modifiable_gerant} onChange={(e) => setForm({ ...form, modifiable_gerant: e.target.checked })} />
              Modifiable par le gérant
            </label>
            <label className="block">
              <span className="text-[12px] font-medium" style={{ color: "var(--sa-text-2)" }}>Description</span>
              <textarea className="mt-1 w-full rounded-lg px-3 py-2 text-sm" rows={2} style={{ border: "1px solid var(--sa-border)" }} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </label>
            <label className="block">
              <span className="text-[12px] font-medium" style={{ color: "var(--sa-text-2)" }}>Ordre</span>
              <input type="number" className="mt-1 w-full h-11 rounded-lg px-3 text-sm" style={{ border: "1px solid var(--sa-border)" }} value={form.ordre} onChange={(e) => setForm({ ...form, ordre: e.target.value })} />
            </label>
            <div className="flex gap-2 pt-2">
              <button type="submit" disabled={saving} className="min-h-[44px] px-4 rounded-lg text-[13px] font-semibold text-white inline-flex items-center gap-2" style={{ background: "var(--sa-primary)" }}>
                {saving ? <Loader2 size={14} className="animate-spin" /> : null}
                Enregistrer
              </button>
              <button type="button" onClick={() => setModal(null)} className="min-h-[44px] px-4 rounded-lg text-[13px]" style={{ border: "1px solid var(--sa-border)" }}>Annuler</button>
            </div>
          </form>
        </div>
      ) : null}

      <ConfirmationModal
        ouvert={Boolean(confirmOff)}
        titre="Désactiver cette commodité ?"
        texte="Cette commodité sera retirée de tous les terrains. Confirmer ?"
        variante="warning"
        onAnnuler={() => setConfirmOff(null)}
        onConfirmer={async () => {
          if (!confirmOff) return;
          try {
            await superAdminApi.updateCommodite(confirmOff.id, { actif: 0 });
            toast.success("Commodité désactivée");
            setConfirmOff(null);
            await load();
          } catch (err) {
            toast.error(err instanceof Error ? err.message : "Impossible de désactiver");
          }
        }}
      />
    </div>
  );
}
