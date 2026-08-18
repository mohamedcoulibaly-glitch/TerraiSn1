import { FormEvent, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { superAdminApi } from "@/services/superAdminApi";
import { useSaCrumbs } from "@/espaces/backoffice/layout/SuperadminLayout";
import Select2 from "@/components/Select2";

const roleBadge: Record<string, string> = {
  gerant: "bg-[color-mix(in_srgb,var(--color-info)_14%,white)] text-[var(--color-info)]",
  proprietaire:
    "bg-[color-mix(in_srgb,var(--color-accent)_20%,white)] text-[var(--color-accent)]",
  super_admin:
    "bg-[color-mix(in_srgb,var(--color-primary)_12%,white)] text-[var(--color-primary)]",
};

export default function GestionUtilisateurs() {
  useSaCrumbs([{ label: "Utilisateurs", to: "/backoffice/superadmin/utilisateurs" }]);
  const [users, setUsers] = useState<any[]>([]);
  const [terrains, setTerrains] = useState<any[]>([]);
  const [show, setShow] = useState(false);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    nom: "",
    telephone: "",
    email: "",
    role: "gerant",
    terrain_id: "",
  });

  const load = () =>
    Promise.all([superAdminApi.users(), superAdminApi.terrains()]).then(([u, t]) => {
      setUsers(u);
      setTerrains(t);
    });

  useEffect(() => {
    load().catch(console.error);
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setMessage("");
    setSaving(true);
    try {
      await superAdminApi.createUser({
        nom: form.nom,
        telephone: form.telephone,
        role: form.role,
        email: form.email || undefined,
        terrain_id: form.terrain_id ? Number(form.terrain_id) : null,
      });
      setMessage("Accès créés et envoyés par WhatsApp.");
      setShow(false);
      setForm({ nom: "", telephone: "", email: "", role: "gerant", terrain_id: "" });
      await load();
    } catch (err: any) {
      setMessage(err.message);
    } finally {
      setSaving(false);
    }
  }

  const fieldClass =
    "w-full h-[48px] rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 text-sm outline-none focus:border-[var(--color-primary)] bg-white";

  return (
    <div className="space-y-6 max-w-6xl">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2
            className="text-xl font-semibold text-[var(--color-text-primary)]"
            style={{ fontFamily: "var(--font-display)" }}
          >
            Gestion des utilisateurs
          </h2>
          <p className="text-sm text-[var(--color-text-secondary)] mt-1">{users.length} comptes</p>
        </div>
        <button
          type="button"
          onClick={() => setShow(!show)}
          className="min-h-[52px] px-5 rounded-[var(--radius-md)] bg-[var(--color-primary)] text-white text-sm font-medium hover:bg-[var(--color-primary-light)]"
        >
          {show ? "Fermer" : "Créer un accès"}
        </button>
      </div>

      {message && (
        <p className="text-sm text-[var(--color-primary)] bg-[color-mix(in_srgb,var(--color-primary)_10%,white)] rounded-[var(--radius-md)] px-4 py-3">
          {message}
        </p>
      )}

      {show && (
        <form
          onSubmit={submit}
          className="bg-white rounded-[var(--radius-lg)] p-5 sm:p-6 shadow-sm border border-[var(--color-border)] grid grid-cols-1 sm:grid-cols-2 gap-4"
        >
          <input
            className={fieldClass}
            placeholder="Nom"
            value={form.nom}
            onChange={(e) => setForm({ ...form, nom: e.target.value })}
            required
          />
          <input
            className={fieldClass}
            placeholder="Téléphone WhatsApp"
            value={form.telephone}
            onChange={(e) => setForm({ ...form, telephone: e.target.value })}
            required
          />
          <input
            className={fieldClass}
            type="email"
            placeholder="Email (optionnel)"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
          <Select2
            value={form.role}
            onChange={(role) => setForm({ ...form, role, terrain_id: "" })}
            options={[
              { value: "gerant", label: "Gérant" },
              { value: "proprietaire", label: "Propriétaire" },
            ]}
          />
          {form.role === "gerant" ? (
            <div className="sm:col-span-2">
              <Select2
                value={form.terrain_id}
                onChange={(terrain_id) => setForm({ ...form, terrain_id })}
                required
                placeholder="Terrain associé"
                options={terrains.map((t) => ({ value: String(t.id), label: t.nom }))}
              />
            </div>
          ) : null}
          {form.role === "proprietaire" && (
            <p className="sm:col-span-2 rounded-[var(--radius-md)] bg-[color-mix(in_srgb,var(--color-primary)_8%,white)] px-4 py-3 text-sm text-[var(--color-text-secondary)]">
              Le proprietaire sera cree sans terrain. Vous pourrez lui associer un terrain ensuite depuis la gestion des terrains.
            </p>
          )}
          <button
            type="submit"
            disabled={saving}
            className="min-h-[52px] sm:col-span-2 rounded-[var(--radius-md)] bg-[var(--color-primary)] text-white text-sm font-medium hover:bg-[var(--color-primary-light)] disabled:bg-[var(--color-text-muted)] inline-flex items-center justify-center gap-2"
          >
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            Créer et envoyer
          </button>
        </form>
      )}

      {/* Mobile cards */}
      <div className="flex flex-col gap-3 md:hidden">
        {users.map((u, i) => (
          <article
            key={`${u.role}-${u.id}-${i}`}
            className="bg-white rounded-[var(--radius-md)] border border-[var(--color-border)] p-4 shadow-sm"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-semibold text-sm" style={{ fontFamily: "var(--font-display)" }}>
                  {u.nom}
                </p>
                <p className="text-xs text-[var(--color-text-muted)] mt-1">{u.telephone}</p>
                <p className="text-xs text-[var(--color-text-secondary)] mt-1">
                  Terrain : {u.terrain_nom || "—"}
                </p>
              </div>
              <span
                className={`text-[10px] font-medium px-2.5 py-1 rounded-full capitalize ${
                  roleBadge[u.role] || roleBadge.gerant
                }`}
              >
                {u.role}
              </span>
            </div>
            <p className="text-[11px] text-[var(--color-text-muted)] mt-3">
              Mot de passe : {u.must_change_password ? "Changement requis" : "Défini"}
            </p>
          </article>
        ))}
      </div>

      {/* Desktop table */}
      <div className="hidden md:block bg-white rounded-[var(--radius-lg)] shadow-sm border border-[var(--color-border)] overflow-x-auto">
        <table className="bo-table">
          <thead>
            <tr>
              <th>Nom</th>
              <th>Téléphone</th>
              <th>Rôle</th>
              <th>Terrain</th>
              <th>Mot de passe</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u, i) => (
              <tr key={`${u.role}-${u.id}-${i}`}>
                <td className="font-medium">{u.nom}</td>
                <td>{u.telephone}</td>
                <td>
                  <span
                    className={`text-[10px] font-medium px-2.5 py-1 rounded-full capitalize ${
                      roleBadge[u.role] || roleBadge.gerant
                    }`}
                  >
                    {u.role}
                  </span>
                </td>
                <td>{u.terrain_nom || "—"}</td>
                <td>{u.must_change_password ? "Changement requis" : "Défini"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
