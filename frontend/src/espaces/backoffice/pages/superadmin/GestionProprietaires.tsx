import { FormEvent, useEffect, useMemo, useState } from "react";
import { Loader2, Pencil, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { superAdminApi } from "@/services/superAdminApi";
import { useSaCrumbs } from "@/espaces/backoffice/layout/SuperadminLayout";
import SaPageHeader from "@/espaces/backoffice/components/superadmin/ui/SaPageHeader";
import SaButton from "@/espaces/backoffice/components/superadmin/ui/SaButton";
import { ConfirmationModal } from "@/espaces/backoffice/components/superadmin/ConfirmationModal";

type Proprietaire = {
  id: number;
  nom?: string | null;
  prenom?: string | null;
  telephone?: string | null;
  email?: string | null;
  statut?: string | null;
  must_change_password?: number | boolean;
  nb_terrains?: number;
  nb_gerants?: number;
};

function displayName(p: Proprietaire) {
  return [p.prenom, p.nom].filter(Boolean).join(" ") || p.nom || "—";
}

function statutMeta(statut?: string | null) {
  const s = String(statut || "actif").toLowerCase();
  if (s === "actif") return { label: "Actif", color: "var(--sa-success)", bg: "var(--sa-success-bg)" };
  if (s === "bloque" || s === "suspendu") return { label: "Bloqué", color: "var(--sa-danger)", bg: "var(--sa-danger-bg)" };
  return { label: "Inactif", color: "var(--sa-muted)", bg: "var(--sa-surface-2)" };
}

export default function GestionProprietaires() {
  useSaCrumbs([
    { label: "Utilisateurs", to: "/backoffice/superadmin/utilisateurs" },
    { label: "Propriétaires", to: "/backoffice/superadmin/proprietaires" },
  ]);

  const [items, setItems] = useState<Proprietaire[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Proprietaire | null>(null);
  const [toggleTarget, setToggleTarget] = useState<Proprietaire | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ nom: "", prenom: "", telephone: "", email: "" });

  const load = async () => {
    setLoading(true);
    try {
      const rows = await superAdminApi.proprietaires();
      setItems(Array.isArray(rows) ? rows : []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Chargement impossible");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return items;
    return items.filter((p) =>
      `${p.nom} ${p.prenom} ${p.telephone} ${p.email}`.toLowerCase().includes(term),
    );
  }, [items, q]);

  function openCreate() {
    setEditing(null);
    setForm({ nom: "", prenom: "", telephone: "", email: "" });
    setShowForm(true);
  }

  function openEdit(p: Proprietaire) {
    setEditing(p);
    setForm({
      nom: p.nom || "",
      prenom: p.prenom || "",
      telephone: p.telephone || "",
      email: p.email || "",
    });
    setShowForm(true);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      if (editing) {
        await superAdminApi.patchProprietaire(editing.id, form);
        toast.success("Propriétaire mis à jour");
      } else {
        await superAdminApi.createProprietaire(form);
        toast.success("Propriétaire créé — accès envoyé par WhatsApp si disponible");
      }
      setShowForm(false);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Enregistrement impossible");
    } finally {
      setSaving(false);
    }
  }

  async function confirmToggle() {
    if (!toggleTarget) return;
    const actif = String(toggleTarget.statut || "").toLowerCase() === "actif";
    try {
      await superAdminApi.patchProprietaire(toggleTarget.id, { statut: actif ? "inactif" : "actif" });
      toast.success(actif ? "Propriétaire désactivé" : "Propriétaire réactivé");
      setToggleTarget(null);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Action impossible");
    }
  }

  return (
    <div className="space-y-5 max-w-6xl">
      <SaPageHeader
        titre="Propriétaires"
        sousTitre={`${filtered.length} compte${filtered.length > 1 ? "s" : ""} — propriétaires de terrains`}
        actions={<SaButton icon={<UserPlus size={14} />} onClick={openCreate}>+ Nouveau propriétaire</SaButton>}
      />

      <div className="flex flex-wrap gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Rechercher (nom, téléphone…)"
          className="sa-input max-w-sm"
        />
      </div>

      {showForm ? (
        <form
          onSubmit={submit}
          className="rounded-xl p-5 grid grid-cols-1 sm:grid-cols-2 gap-3"
          style={{ background: "var(--sa-surface)", boxShadow: "var(--sa-shadow)" }}
        >
          <h3 className="sm:col-span-2 text-[15px] font-semibold" style={{ color: "var(--sa-text)" }}>
            {editing ? "Modifier le propriétaire" : "Créer un propriétaire"}
          </h3>
          <input className="sa-input" placeholder="Prénom" value={form.prenom} onChange={(e) => setForm({ ...form, prenom: e.target.value })} />
          <input className="sa-input" placeholder="Nom *" required value={form.nom} onChange={(e) => setForm({ ...form, nom: e.target.value })} />
          <input className="sa-input" placeholder="Téléphone WhatsApp *" required value={form.telephone} onChange={(e) => setForm({ ...form, telephone: e.target.value })} />
          <input className="sa-input" type="email" placeholder="Email (optionnel)" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          {!editing ? (
            <p className="sm:col-span-2 text-[12px]" style={{ color: "var(--sa-muted)" }}>
              Un mot de passe temporaire sera généré et envoyé par WhatsApp. Tu pourras ensuite lui associer des terrains.
            </p>
          ) : null}
          <div className="sm:col-span-2 flex gap-2 justify-end">
            <SaButton type="button" variant="secondary" onClick={() => setShowForm(false)}>Annuler</SaButton>
            <SaButton type="submit" disabled={saving}>
              {saving ? <Loader2 size={14} className="animate-spin" /> : null}
              {editing ? "Enregistrer" : "Créer et envoyer"}
            </SaButton>
          </div>
        </form>
      ) : null}

      {loading ? (
        <p className="text-sm flex items-center gap-2" style={{ color: "var(--sa-muted)" }}>
          <Loader2 size={16} className="animate-spin" /> Chargement…
        </p>
      ) : (
        <div className="rounded-xl overflow-hidden" style={{ background: "var(--sa-surface)", boxShadow: "var(--sa-shadow)" }}>
          <table className="sa-table">
            <thead>
              <tr>
                <th>Nom</th>
                <th>Téléphone</th>
                <th>Email</th>
                <th>Terrains</th>
                <th>Statut</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => {
                const st = statutMeta(p.statut);
                const actif = String(p.statut || "").toLowerCase() === "actif";
                return (
                  <tr key={p.id} style={{ opacity: actif ? 1 : 0.65 }}>
                    <td className="font-medium">{displayName(p)}</td>
                    <td>{p.telephone || "—"}</td>
                    <td className="text-[12px]">{p.email || "—"}</td>
                    <td>{Number(p.nb_terrains || 0)}</td>
                    <td>
                      <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ background: st.bg, color: st.color }}>
                        {st.label}
                      </span>
                    </td>
                    <td>
                      <div className="flex items-center gap-2">
                        <button type="button" className="sa-btn sa-btn-sm sa-btn-secondary inline-flex items-center gap-1" onClick={() => openEdit(p)}>
                          <Pencil size={12} /> Modifier
                        </button>
                        <button
                          type="button"
                          className="sa-btn sa-btn-sm"
                          style={{ color: actif ? "var(--sa-danger)" : "var(--sa-success)" }}
                          onClick={() => setToggleTarget(p)}
                        >
                          {actif ? "Désactiver" : "Activer"}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!filtered.length ? (
                <tr>
                  <td colSpan={6} className="text-center text-[13px]" style={{ color: "var(--sa-muted)" }}>
                    Aucun propriétaire
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmationModal
        ouvert={Boolean(toggleTarget)}
        titre={
          toggleTarget && String(toggleTarget.statut || "").toLowerCase() === "actif"
            ? `Désactiver ${displayName(toggleTarget)} ?`
            : `Réactiver ${toggleTarget ? displayName(toggleTarget) : ""} ?`
        }
        texte="Le propriétaire ne pourra plus se connecter si le compte est inactif."
        labelConfirmer="Confirmer"
        variante="warning"
        onConfirmer={() => void confirmToggle()}
        onAnnuler={() => setToggleTarget(null)}
      />
    </div>
  );
}
