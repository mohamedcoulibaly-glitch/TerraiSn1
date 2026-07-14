import { FormEvent, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { superAdminApi } from "@/services/superAdminApi";

export default function GestionTerrains() {
  const [items, setItems] = useState<any[]>([]);
  const [owners, setOwners] = useState<any[]>([]);
  const [show, setShow] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toggling, setToggling] = useState<number | null>(null);
  const [form, setForm] = useState({
    nom: "",
    quartier: "",
    ville: "Dakar",
    surface: "synthétique",
    taille: "11v11",
    prix_heure: "",
    photos: "",
    proprietaire_id: "",
  });

  const load = () =>
    Promise.all([superAdminApi.terrains(), superAdminApi.users()]).then(([t, u]) => {
      setItems(t);
      setOwners(u.filter((x: any) => x.role === "proprietaire"));
    });

  useEffect(() => {
    load().catch(console.error);
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await superAdminApi.createTerrain({
        ...form,
        photos: form.photos
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean),
        prix_heure: Number(form.prix_heure),
        proprietaire_id: Number(form.proprietaire_id),
      });
      setShow(false);
      setForm({
        nom: "",
        quartier: "",
        ville: "Dakar",
        surface: "synthétique",
        taille: "11v11",
        prix_heure: "",
        photos: "",
        proprietaire_id: "",
      });
      await load();
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
            Gestion des terrains
          </h2>
          <p className="text-sm text-[var(--color-text-secondary)] mt-1">{items.length} terrains</p>
        </div>
        <button
          type="button"
          onClick={() => setShow(!show)}
          className="min-h-[52px] px-5 rounded-[var(--radius-md)] bg-[var(--color-primary)] text-white text-sm font-medium hover:bg-[var(--color-primary-light)]"
        >
          {show ? "Fermer" : "Ajouter un terrain"}
        </button>
      </div>

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
            placeholder="Quartier"
            value={form.quartier}
            onChange={(e) => setForm({ ...form, quartier: e.target.value })}
          />
          <input
            className={fieldClass}
            placeholder="Ville"
            value={form.ville}
            onChange={(e) => setForm({ ...form, ville: e.target.value })}
          />
          <select
            className={fieldClass}
            value={form.surface}
            onChange={(e) => setForm({ ...form, surface: e.target.value })}
          >
            <option>gazon</option>
            <option>synthétique</option>
          </select>
          <select
            className={fieldClass}
            value={form.taille}
            onChange={(e) => setForm({ ...form, taille: e.target.value })}
          >
            <option>5v5</option>
            <option>7v7</option>
            <option>11v11</option>
          </select>
          <input
            className={fieldClass}
            type="number"
            placeholder="Prix par heure"
            value={form.prix_heure}
            onChange={(e) => setForm({ ...form, prix_heure: e.target.value })}
            required
          />
          <input
            className={`${fieldClass} sm:col-span-2`}
            placeholder="Photos (URLs séparées par des virgules)"
            value={form.photos}
            onChange={(e) => setForm({ ...form, photos: e.target.value })}
          />
          <select
            className={fieldClass}
            value={form.proprietaire_id}
            onChange={(e) => setForm({ ...form, proprietaire_id: e.target.value })}
            required
          >
            <option value="">Propriétaire</option>
            {owners.map((o) => (
              <option key={o.id} value={o.id}>
                {o.nom}
              </option>
            ))}
          </select>
          <button
            type="submit"
            disabled={saving}
            className="min-h-[52px] rounded-[var(--radius-md)] bg-[var(--color-primary)] text-white text-sm font-medium hover:bg-[var(--color-primary-light)] disabled:bg-[var(--color-text-muted)] inline-flex items-center justify-center gap-2"
          >
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            Enregistrer
          </button>
        </form>
      )}

      {/* Mobile cards */}
      <div className="flex flex-col gap-3 md:hidden">
        {items.map((t) => (
          <article
            key={t.id}
            className={`bg-white rounded-[var(--radius-md)] border border-[var(--color-border)] border-l-4 p-4 shadow-sm ${
              t.is_active ? "border-l-[var(--color-success)]" : "border-l-[var(--color-danger)]"
            }`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-semibold text-sm" style={{ fontFamily: "var(--font-display)" }}>
                  {t.nom}
                </p>
                <p className="text-xs text-[var(--color-text-muted)] mt-1">
                  {t.adresse || t.quartier || "—"} · {t.ville}
                </p>
                <p className="text-xs text-[var(--color-text-secondary)] mt-1">
                  {t.proprietaire_nom || "Sans propriétaire"}
                </p>
              </div>
              <span
                className={`text-[10px] font-medium px-2.5 py-1 rounded-full ${
                  t.is_active
                    ? "bg-[color-mix(in_srgb,var(--color-success)_14%,white)] text-[var(--color-success)]"
                    : "bg-[color-mix(in_srgb,var(--color-danger)_12%,white)] text-[var(--color-danger)]"
                }`}
              >
                {t.is_active ? "Actif" : "Suspendu"}
              </span>
            </div>
            <button
              type="button"
              disabled={toggling === t.id}
              className="mt-3 min-h-[44px] px-4 rounded-[var(--radius-sm)] border border-[var(--color-border)] text-xs font-medium text-[var(--color-primary)] disabled:opacity-50"
              onClick={async () => {
                setToggling(t.id);
                try {
                  await superAdminApi.terrainStatus(t.id, t.is_active ? "suspendu" : "actif");
                  await load();
                } finally {
                  setToggling(null);
                }
              }}
            >
              {toggling === t.id ? "…" : t.is_active ? "Suspendre" : "Activer"}
            </button>
          </article>
        ))}
      </div>

      {/* Desktop table */}
      <div className="hidden md:block bg-white rounded-[var(--radius-lg)] shadow-sm border border-[var(--color-border)] overflow-x-auto">
        <table className="bo-table">
          <thead>
            <tr>
              <th>Nom</th>
              <th>Quartier</th>
              <th>Propriétaire</th>
              <th>Statut</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.map((t) => (
              <tr key={t.id}>
                <td className="font-medium">{t.nom}</td>
                <td>
                  {t.adresse || t.quartier || "—"}
                  {t.ville ? `, ${t.ville}` : ""}
                </td>
                <td>{t.proprietaire_nom || "—"}</td>
                <td>
                  <span
                    className={`badge-status ${t.is_active ? "badge-status-actif" : "badge-status-suspendu"}`}
                  >
                    {t.is_active ? "Actif" : "Suspendu"}
                  </span>
                </td>
                <td>
                  <button
                    type="button"
                    disabled={toggling === t.id}
                    className="text-sm text-[var(--color-primary)] font-medium hover:underline disabled:opacity-50"
                    onClick={async () => {
                      setToggling(t.id);
                      try {
                        await superAdminApi.terrainStatus(t.id, t.is_active ? "suspendu" : "actif");
                        await load();
                      } finally {
                        setToggling(null);
                      }
                    }}
                  >
                    {t.is_active ? "Suspendre" : "Activer"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
