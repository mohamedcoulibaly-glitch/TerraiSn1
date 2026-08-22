import { FormEvent, useEffect, useMemo, useState } from "react";
import { Loader2, Pencil, Shield, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { superAdminApi } from "@/services/superAdminApi";
import { useSaCrumbs } from "@/espaces/backoffice/layout/SuperadminLayout";
import SaPageHeader from "@/espaces/backoffice/components/superadmin/ui/SaPageHeader";
import SaButton from "@/espaces/backoffice/components/superadmin/ui/SaButton";
import { ConfirmationModal } from "@/espaces/backoffice/components/superadmin/ConfirmationModal";

type SuperAdmin = {
  id: number;
  nom?: string | null;
  prenom?: string | null;
  telephone?: string | null;
  email?: string | null;
  is_active?: number | boolean;
  must_change_password?: number | boolean;
  created_at?: string | null;
};

function displayName(u: SuperAdmin) {
  return [u.prenom, u.nom].filter(Boolean).join(" ") || u.nom || "—";
}

export default function GestionSuperadmins() {
  useSaCrumbs([
    { label: "Utilisateurs", to: "/backoffice/superadmin/utilisateurs" },
    { label: "Superadmins", to: "/backoffice/superadmin/superadmins" },
  ]);

  const { user } = useAuth();
  const [items, setItems] = useState<SuperAdmin[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<SuperAdmin | null>(null);
  const [toggleTarget, setToggleTarget] = useState<SuperAdmin | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ nom: "", prenom: "", telephone: "", email: "" });

  const load = async () => {
    setLoading(true);
    try {
      const rows = await superAdminApi.superadmins();
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
    return items.filter((u) =>
      `${u.nom} ${u.prenom} ${u.telephone} ${u.email}`.toLowerCase().includes(term),
    );
  }, [items, q]);

  function openCreate() {
    setEditing(null);
    setForm({ nom: "", prenom: "", telephone: "", email: "" });
    setShowForm(true);
  }

  function openEdit(u: SuperAdmin) {
    setEditing(u);
    setForm({
      nom: u.nom || "",
      prenom: u.prenom || "",
      telephone: u.telephone || "",
      email: u.email || "",
    });
    setShowForm(true);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      if (editing) {
        await superAdminApi.patchSuperadmin(editing.id, form);
        toast.success("Superadmin mis à jour");
      } else {
        await superAdminApi.createSuperadmin(form);
        toast.success("Superadmin créé — accès envoyé par WhatsApp si disponible");
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
    const actif = Number(toggleTarget.is_active) === 1;
    try {
      await superAdminApi.patchSuperadmin(toggleTarget.id, { is_active: actif ? 0 : 1 });
      toast.success(actif ? "Compte désactivé" : "Compte réactivé");
      setToggleTarget(null);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Action impossible");
    }
  }

  return (
    <div className="space-y-5 max-w-6xl">
      <SaPageHeader
        titre="Superadmins"
        sousTitre="Comptes qui supervisent le SaaS TerrainSN (accès backoffice admin)"
        actions={<SaButton icon={<UserPlus size={14} />} onClick={openCreate}>+ Nouveau superadmin</SaButton>}
      />

      <div
        className="rounded-xl px-4 py-3 flex items-start gap-3 text-[13px]"
        style={{ background: "var(--sa-info-bg, var(--sa-surface-2))", color: "var(--sa-text)" }}
      >
        <Shield size={18} className="shrink-0 mt-0.5" style={{ color: "var(--sa-primary)" }} />
        <p>
          Chaque superadmin peut gérer terrains, contrats, gérants et propriétaires.
          Tu ne peux pas désactiver ton propre compte ni le dernier superadmin actif.
        </p>
      </div>

      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Rechercher…"
        className="sa-input max-w-sm"
      />

      {showForm ? (
        <form
          onSubmit={submit}
          className="rounded-xl p-5 grid grid-cols-1 sm:grid-cols-2 gap-3"
          style={{ background: "var(--sa-surface)", boxShadow: "var(--sa-shadow)" }}
        >
          <h3 className="sm:col-span-2 text-[15px] font-semibold" style={{ color: "var(--sa-text)" }}>
            {editing ? "Modifier le superadmin" : "Créer un superadmin"}
          </h3>
          <input className="sa-input" placeholder="Prénom" value={form.prenom} onChange={(e) => setForm({ ...form, prenom: e.target.value })} />
          <input className="sa-input" placeholder="Nom *" required value={form.nom} onChange={(e) => setForm({ ...form, nom: e.target.value })} />
          <input className="sa-input" placeholder="Téléphone *" required value={form.telephone} onChange={(e) => setForm({ ...form, telephone: e.target.value })} />
          <input className="sa-input" type="email" placeholder="Email (optionnel)" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          {!editing ? (
            <p className="sm:col-span-2 text-[12px]" style={{ color: "var(--sa-muted)" }}>
              Connexion via http://localhost:8080/backoffice/login avec le téléphone + mot de passe temporaire WhatsApp.
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
                <th>Statut</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((u) => {
                const actif = Number(u.is_active) === 1;
                const isMe = Number(user?.id) === Number(u.id);
                return (
                  <tr key={u.id} style={{ opacity: actif ? 1 : 0.65 }}>
                    <td className="font-medium">
                      {displayName(u)}
                      {isMe ? (
                        <span className="ml-2 text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ background: "var(--sa-primary-glow)", color: "var(--sa-primary)" }}>
                          Toi
                        </span>
                      ) : null}
                    </td>
                    <td>{u.telephone || "—"}</td>
                    <td className="text-[12px]">{u.email || "—"}</td>
                    <td>
                      <span
                        className="rounded-full px-2 py-0.5 text-[11px] font-semibold"
                        style={{
                          background: actif ? "var(--sa-success-bg)" : "var(--sa-surface-2)",
                          color: actif ? "var(--sa-success)" : "var(--sa-muted)",
                        }}
                      >
                        {actif ? "Actif" : "Inactif"}
                      </span>
                    </td>
                    <td>
                      <div className="flex items-center gap-2">
                        <button type="button" className="sa-btn sa-btn-sm sa-btn-secondary inline-flex items-center gap-1" onClick={() => openEdit(u)}>
                          <Pencil size={12} /> Modifier
                        </button>
                        <button
                          type="button"
                          className="sa-btn sa-btn-sm"
                          disabled={isMe && actif}
                          style={{ color: actif ? "var(--sa-danger)" : "var(--sa-success)", opacity: isMe && actif ? 0.4 : 1 }}
                          onClick={() => setToggleTarget(u)}
                          title={isMe && actif ? "Tu ne peux pas te désactiver" : undefined}
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
                  <td colSpan={5} className="text-center text-[13px]" style={{ color: "var(--sa-muted)" }}>
                    Aucun superadmin
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
          toggleTarget && Number(toggleTarget.is_active) === 1
            ? `Désactiver ${displayName(toggleTarget)} ?`
            : `Réactiver ${toggleTarget ? displayName(toggleTarget) : ""} ?`
        }
        texte="Un superadmin inactif ne peut plus accéder au backoffice de supervision."
        labelConfirmer="Confirmer"
        variante="danger"
        onConfirmer={() => void confirmToggle()}
        onAnnuler={() => setToggleTarget(null)}
      />
    </div>
  );
}
