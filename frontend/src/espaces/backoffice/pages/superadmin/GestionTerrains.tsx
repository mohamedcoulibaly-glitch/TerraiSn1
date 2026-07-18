import { FormEvent, useEffect, useState } from "react";
import { Loader2, Upload } from "lucide-react";
import { superAdminApi } from "@/services/superAdminApi";

const emptyForm = {
  nom: "",
  quartier: "",
  ville: "Dakar",
  surface: "synthetique",
  taille: "11v11",
  prix_heure: "",
  prix_moitie: "",
  pourcentage_avance: "12.5",
  modele_revenus: "commission",
  commission_pourcentage: "10",
  abonnement_montant: "",
  achat_definitif_montant: "",
  latitude: "",
  longitude: "",
  photos: "",
  proprietaire_id: "",
};

function revenueLabel(terrain: any) {
  if (terrain.modele_revenus === "abonnement") {
    return `Abonnement ${Number(terrain.abonnement_montant || 0).toLocaleString()} CFA`;
  }
  if (terrain.modele_revenus === "achat_definitif") {
    return terrain.achat_definitif_paye ? "Achat definitif paye" : "Achat definitif en attente";
  }
  return `Commission ${Number(terrain.commission_pourcentage || 0).toLocaleString()}%`;
}

export default function GestionTerrains() {
  const [items, setItems] = useState<any[]>([]);
  const [owners, setOwners] = useState<any[]>([]);
  const [show, setShow] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toggling, setToggling] = useState<number | null>(null);
  const [payingTerrain, setPayingTerrain] = useState<number | null>(null);
  const [uploadingTerrain, setUploadingTerrain] = useState<number | null>(null);
  const [form, setForm] = useState(emptyForm);

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
      const prixEntier = Number(form.prix_heure);
      await superAdminApi.createTerrain({
        ...form,
        photos: form.photos
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean),
        prix_heure: prixEntier,
        prix_entier: prixEntier,
        prix_moitie: Number(form.prix_moitie || prixEntier * 0.6),
        pourcentage_avance: Number(form.pourcentage_avance || 12.5),
        commission_pourcentage:
          form.modele_revenus === "commission" ? Number(form.commission_pourcentage || 0) : 0,
        abonnement_montant:
          form.modele_revenus === "abonnement" ? Number(form.abonnement_montant || 0) : 0,
        achat_definitif_montant:
          form.modele_revenus === "achat_definitif" ? Number(form.achat_definitif_montant || 0) : 0,
        latitude: form.latitude ? Number(form.latitude) : null,
        longitude: form.longitude ? Number(form.longitude) : null,
        proprietaire_id: Number(form.proprietaire_id),
      });
      setShow(false);
      setForm(emptyForm);
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function markPurchasePaid(terrain: any) {
    setPayingTerrain(terrain.id);
    try {
      await superAdminApi.payerAchatDefinitif(terrain.id, Number(terrain.achat_definitif_montant || 0));
      await load();
    } finally {
      setPayingTerrain(null);
    }
  }

  const readFileAsDataUrl = (file: File) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });

  async function uploadPhoto(terrainId: number, file?: File | null) {
    if (!file) return;
    setUploadingTerrain(terrainId);
    try {
      const dataUrl = await readFileAsDataUrl(file);
      await superAdminApi.uploadTerrainPhoto(terrainId, { dataUrl, est_principale: true, ordre: 0 });
      await load();
    } finally {
      setUploadingTerrain(null);
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
          <input
            className={fieldClass}
            type="number"
            step="any"
            placeholder="Latitude"
            value={form.latitude}
            onChange={(e) => setForm({ ...form, latitude: e.target.value })}
          />
          <input
            className={fieldClass}
            type="number"
            step="any"
            placeholder="Longitude"
            value={form.longitude}
            onChange={(e) => setForm({ ...form, longitude: e.target.value })}
          />
          <select
            className={fieldClass}
            value={form.surface}
            onChange={(e) => setForm({ ...form, surface: e.target.value })}
          >
            <option value="gazon_naturel">Gazon naturel</option>
            <option value="gazon_synthetique">Gazon synthetique</option>
            <option value="beton">Beton</option>
          </select>
          <select
            className={fieldClass}
            value={form.taille}
            onChange={(e) => setForm({ ...form, taille: e.target.value })}
          >
            <option value="5v5">5v5</option>
            <option value="7v7">7v7</option>
            <option value="11v11">11v11</option>
          </select>
          <input
            className={fieldClass}
            type="number"
            placeholder="Prix terrain entier / heure"
            value={form.prix_heure}
            onChange={(e) => setForm({ ...form, prix_heure: e.target.value })}
            required
          />
          <input
            className={fieldClass}
            type="number"
            placeholder="Prix demi-terrain / heure"
            value={form.prix_moitie}
            onChange={(e) => setForm({ ...form, prix_moitie: e.target.value })}
          />
          <input
            className={fieldClass}
            type="number"
            min="1"
            max="100"
            step="0.1"
            placeholder="Avance (%)"
            value={form.pourcentage_avance}
            onChange={(e) => setForm({ ...form, pourcentage_avance: e.target.value })}
            required
          />
          <select
            className={fieldClass}
            value={form.modele_revenus}
            onChange={(e) => setForm({ ...form, modele_revenus: e.target.value })}
          >
            <option value="commission">Commission</option>
            <option value="abonnement">Abonnement mensuel</option>
            <option value="achat_definitif">Achat definitif</option>
          </select>
          {form.modele_revenus === "commission" && (
            <input
              className={fieldClass}
              type="number"
              min="0"
              max="100"
              step="0.1"
              placeholder="Commission plateforme (%)"
              value={form.commission_pourcentage}
              onChange={(e) => setForm({ ...form, commission_pourcentage: e.target.value })}
            />
          )}
          {form.modele_revenus === "abonnement" && (
            <input
              className={fieldClass}
              type="number"
              min="0"
              placeholder="Abonnement mensuel (CFA)"
              value={form.abonnement_montant}
              onChange={(e) => setForm({ ...form, abonnement_montant: e.target.value })}
            />
          )}
          {form.modele_revenus === "achat_definitif" && (
            <input
              className={fieldClass}
              type="number"
              min="0"
              placeholder="Achat definitif (CFA)"
              value={form.achat_definitif_montant}
              onChange={(e) => setForm({ ...form, achat_definitif_montant: e.target.value })}
            />
          )}
          <input
            className={`${fieldClass} sm:col-span-2`}
            placeholder="Photos (URLs separees par des virgules)"
            value={form.photos}
            onChange={(e) => setForm({ ...form, photos: e.target.value })}
          />
          <select
            className={fieldClass}
            value={form.proprietaire_id}
            onChange={(e) => setForm({ ...form, proprietaire_id: e.target.value })}
            required
          >
            <option value="">Proprietaire</option>
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
                  {t.adresse || t.quartier || "-"} - {t.ville}
                </p>
                <p className="text-xs text-[var(--color-text-secondary)] mt-1">
                  {t.proprietaire_nom || "Sans proprietaire"}
                </p>
                <p className="text-xs text-[var(--color-text-secondary)] mt-1">
                  Avance {Number(t.pourcentage_avance || 12.5).toLocaleString()}% - {revenueLabel(t)}
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
              {toggling === t.id ? "..." : t.is_active ? "Suspendre" : "Activer"}
            </button>
            {t.modele_revenus === "achat_definitif" && !t.achat_definitif_paye && (
              <button
                type="button"
                disabled={payingTerrain === t.id}
                className="mt-2 min-h-[44px] px-4 rounded-[var(--radius-sm)] bg-[var(--color-primary)] text-white text-xs font-medium disabled:opacity-50"
                onClick={() => markPurchasePaid(t)}
              >
                {payingTerrain === t.id ? "Validation..." : "Marquer achat paye"}
              </button>
            )}
            <label className="mt-2 min-h-[44px] px-4 rounded-[var(--radius-sm)] border border-[var(--color-border)] text-xs font-medium text-[var(--color-primary)] inline-flex items-center justify-center gap-2 cursor-pointer">
              <Upload className="w-4 h-4" />
              {uploadingTerrain === t.id ? "Upload..." : "Ajouter photo"}
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                disabled={uploadingTerrain === t.id}
                onChange={(e) => uploadPhoto(t.id, e.target.files?.[0])}
              />
            </label>
          </article>
        ))}
      </div>

      <div className="hidden md:block bg-white rounded-[var(--radius-lg)] shadow-sm border border-[var(--color-border)] overflow-x-auto">
        <table className="bo-table">
          <thead>
            <tr>
              <th>Nom</th>
              <th>Quartier</th>
              <th>Proprietaire</th>
              <th>Revenus</th>
              <th>Avance</th>
              <th>Statut</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.map((t) => (
              <tr key={t.id}>
                <td className="font-medium">{t.nom}</td>
                <td>
                  {t.adresse || t.quartier || "-"}
                  {t.ville ? `, ${t.ville}` : ""}
                </td>
                <td>{t.proprietaire_nom || "-"}</td>
                <td>{revenueLabel(t)}</td>
                <td>{Number(t.pourcentage_avance || 12.5).toLocaleString()}%</td>
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
                  {t.modele_revenus === "achat_definitif" && !t.achat_definitif_paye && (
                    <button
                      type="button"
                      disabled={payingTerrain === t.id}
                      className="ml-3 text-sm text-[var(--color-accent)] font-medium hover:underline disabled:opacity-50"
                      onClick={() => markPurchasePaid(t)}
                    >
                      {payingTerrain === t.id ? "Validation..." : "Marquer achat paye"}
                    </button>
                  )}
                  <label className="ml-3 text-sm text-[var(--color-primary)] font-medium hover:underline cursor-pointer">
                    {uploadingTerrain === t.id ? "Upload..." : "Ajouter photo"}
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      className="hidden"
                      disabled={uploadingTerrain === t.id}
                      onChange={(e) => uploadPhoto(t.id, e.target.files?.[0])}
                    />
                  </label>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
