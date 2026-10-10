import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Eye, EyeOff, KeyRound, Loader2, MessageCircle, RefreshCw, Save, Globe } from "lucide-react";
import { toast } from "sonner";
import { superAdminApi } from "@/services/superAdminApi";
import { useSaCrumbs } from "@/espaces/backoffice/layout/SuperadminLayout";
import SaPageHeader from "@/espaces/backoffice/components/superadmin/ui/SaPageHeader";

type Field = {
  env: string;
  group: "paiement" | "whatsapp" | "general";
  label: string;
  hint?: string | null;
  type: string;
  options?: string[] | null;
  secret: boolean;
  source: string;
  configured: boolean;
  value: string;
  preview: string;
  last4: string;
};

type IntegrationsPayload = {
  fields: Field[];
  groups: Record<
    string,
    { title: string; subtitle: string; ready?: boolean; env?: string; mock?: boolean }
  >;
  syncedAt?: string;
  changed?: string[];
  envFile?: { ok?: boolean; written?: number; error?: string };
  whatsappReloaded?: boolean;
};

const GROUP_ORDER: Array<"paiement" | "whatsapp" | "general"> = ["paiement", "whatsapp", "general"];

const GROUP_ICON = {
  paiement: KeyRound,
  whatsapp: MessageCircle,
  general: Globe,
};

export default function IntegrationsPage() {
  useSaCrumbs([{ label: "Paramètres" }, { label: "Intégrations" }]);
  const [data, setData] = useState<IntegrationsPayload | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [showSecret, setShowSecret] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = (await superAdminApi.getIntegrations()) as IntegrationsPayload;
      setData(res);
      const next: Record<string, string> = {};
      for (const f of res.fields || []) {
        // Afficher les valeurs persistées (y compris secrets) pour le superadmin.
        next[f.env] = f.value || "";
      }
      setDraft(next);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Chargement impossible");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const dirty = useMemo(() => {
    if (!data?.fields) return false;
    return data.fields.some((f) => (draft[f.env] ?? "") !== (f.value || ""));
  }, [data, draft]);

  async function save() {
    if (!data?.fields) return;
    const patch: Record<string, string> = {};
    for (const f of data.fields) {
      const d = draft[f.env] ?? "";
      const original = f.value || "";
      if (d === original) continue;
      // Chaîne vide sur secret = conserver (évite d’effacer par erreur).
      if (f.secret && !d.trim()) continue;
      patch[f.env] = d.trim();
    }
    if (!Object.keys(patch).length) {
      toast.message("Aucune modification");
      return;
    }
    setSaving(true);
    try {
      const res = (await superAdminApi.saveIntegrations(patch)) as IntegrationsPayload;
      setData(res);
      const next: Record<string, string> = {};
      for (const f of res.fields || []) {
        next[f.env] = f.value || "";
      }
      setDraft(next);
      const n = res.changed?.length || 0;
      toast.success(
        n
          ? `${n} paramètre(s) synchronisé(s)${res.envFile?.ok === false ? " (fichier .env non écrit)" : ""}`
          : "Enregistré",
      );
      if (res.whatsappReloaded) toast.message("Config WhatsApp rechargée à chaud");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Enregistrement impossible");
    } finally {
      setSaving(false);
    }
  }

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center py-20" style={{ color: "var(--sa-muted)" }}>
        <Loader2 className="animate-spin" size={22} />
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-5">
      <SaPageHeader
        titre="Intégrations"
        sousTitre="Clés paiement en ligne, OpenWA et domaine — synchronisées DB + .env + runtime"
        actions={
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void load()}
              className="min-h-[40px] px-3 rounded-lg text-[13px] font-semibold inline-flex items-center gap-1.5"
              style={{ border: "1px solid var(--sa-border)", color: "var(--sa-text)" }}
            >
              <RefreshCw size={14} />
              Rafraîchir
            </button>
            <button
              type="button"
              disabled={saving || !dirty}
              onClick={() => void save()}
              className="min-h-[40px] px-4 rounded-lg text-[13px] font-semibold text-white inline-flex items-center gap-1.5 disabled:opacity-50"
              style={{ background: "var(--sa-primary)" }}
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              Enregistrer
            </button>
          </div>
        }
      />

      {GROUP_ORDER.map((groupKey) => {
        const meta = data?.groups?.[groupKey];
        const fields = (data?.fields || []).filter((f) => f.group === groupKey);
        if (!fields.length) return null;
        const Icon = GROUP_ICON[groupKey];
        return (
          <section
            key={groupKey}
            className="rounded-xl p-5 space-y-4"
            style={{ background: "var(--sa-surface)", boxShadow: "var(--sa-shadow)" }}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-2.5">
                <Icon size={18} className="mt-0.5 shrink-0" style={{ color: "var(--sa-primary)" }} />
                <div>
                  <h2 className="text-[15px] font-semibold" style={{ color: "var(--sa-text)" }}>
                    {meta?.title || groupKey}
                  </h2>
                  <p className="text-[12px] mt-0.5" style={{ color: "var(--sa-muted)" }}>
                    {meta?.subtitle}
                  </p>
                </div>
              </div>
              <span
                className="shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold"
                style={{
                  background: meta?.ready ? "var(--sa-success-bg)" : "var(--sa-warning-bg)",
                  color: meta?.ready ? "var(--sa-success)" : "var(--sa-warning)",
                }}
              >
                {meta?.ready ? "Configuré" : "Incomplet"}
              </span>
            </div>

            {groupKey === "whatsapp" ? (
              <p className="text-[12px]" style={{ color: "var(--sa-muted)" }}>
                Connexion QR :{" "}
                <Link to="/backoffice/superadmin/whatsapp" className="font-semibold underline" style={{ color: "var(--sa-primary)" }}>
                  WhatsApp plateforme
                </Link>
              </p>
            ) : null}

            <div className="space-y-3">
              {fields.map((f) => (
                <label key={f.env} className="block space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[12px] font-semibold" style={{ color: "var(--sa-text)" }}>
                      {f.label}
                    </span>
                    <span className="text-[10px]" style={{ color: "var(--sa-muted)" }}>
                      {f.configured
                        ? f.secret
                          ? `••••${f.last4} · ${f.source}`
                          : f.source
                        : "non défini"}
                    </span>
                  </div>
                  {f.type === "select" && f.options ? (
                    <select
                      className="w-full h-11 rounded-lg px-3 text-sm"
                      style={{ border: "1px solid var(--sa-border)", background: "var(--sa-surface)" }}
                      value={draft[f.env] ?? ""}
                      onChange={(e) => setDraft((d) => ({ ...d, [f.env]: e.target.value }))}
                    >
                      {f.options.map((opt) => (
                        <option key={opt} value={opt}>
                          {opt}
                        </option>
                      ))}
                    </select>
                  ) : f.type === "boolean" ? (
                    <select
                      className="w-full h-11 rounded-lg px-3 text-sm"
                      style={{ border: "1px solid var(--sa-border)", background: "var(--sa-surface)" }}
                      value={draft[f.env] ?? "false"}
                      onChange={(e) => setDraft((d) => ({ ...d, [f.env]: e.target.value }))}
                    >
                      <option value="true">Activé (true)</option>
                      <option value="false">Désactivé (false)</option>
                    </select>
                  ) : (
                    <div className="relative">
                      <input
                        type={f.secret && !showSecret[f.env] ? "password" : "text"}
                        className="w-full h-11 rounded-lg px-3 pr-10 text-sm"
                        style={{ border: "1px solid var(--sa-border)", background: "var(--sa-surface)" }}
                        value={draft[f.env] ?? ""}
                        placeholder={f.secret && !f.configured ? "Coller la clé" : undefined}
                        autoComplete="off"
                        spellCheck={false}
                        onChange={(e) => setDraft((d) => ({ ...d, [f.env]: e.target.value }))}
                      />
                      {f.secret ? (
                        <button
                          type="button"
                          className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5"
                          style={{ color: "var(--sa-muted)" }}
                          onClick={() => setShowSecret((s) => ({ ...s, [f.env]: !s[f.env] }))}
                          aria-label={showSecret[f.env] ? "Masquer" : "Afficher"}
                        >
                          {showSecret[f.env] ? <EyeOff size={16} /> : <Eye size={16} />}
                        </button>
                      ) : null}
                    </div>
                  )}
                  {f.hint ? (
                    <p className="text-[11px]" style={{ color: "var(--sa-muted)" }}>
                      {f.hint}
                    </p>
                  ) : null}
                </label>
              ))}
            </div>
          </section>
        );
      })}

      {data?.syncedAt ? (
        <p className="text-[11px] text-center" style={{ color: "var(--sa-muted)" }}>
          Dernière sync serveur : {new Date(data.syncedAt).toLocaleString("fr-FR")}
        </p>
      ) : null}
    </div>
  );
}
