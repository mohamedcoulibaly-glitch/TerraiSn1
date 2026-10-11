import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  Bell,
  CreditCard,
  Eye,
  EyeOff,
  Globe,
  KeyRound,
  Loader2,
  MessageCircle,
  PlugZap,
  RefreshCw,
  Save,
} from "lucide-react";
import { toast } from "sonner";
import { superAdminApi } from "@/services/superAdminApi";
import { useSaCrumbs } from "@/espaces/backoffice/layout/SuperadminLayout";
import SaPageHeader from "@/espaces/backoffice/components/superadmin/ui/SaPageHeader";

type GroupKey = "paiement" | "paydunya" | "whatsapp" | "general";

type Field = {
  env: string;
  group: GroupKey;
  label: string;
  hint?: string | null;
  type: string;
  options?: string[] | null;
  secret: boolean;
  readonly?: boolean;
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
    { title: string; subtitle: string; ready?: boolean; env?: string; mock?: boolean; provider?: string }
  >;
  syncedAt?: string;
  changed?: string[];
  envFile?: { ok?: boolean; written?: number; error?: string };
  whatsappReloaded?: boolean;
};

const GROUP_ORDER: GroupKey[] = ["paiement", "paydunya", "whatsapp", "general"];

const GROUP_ICON = {
  paiement: KeyRound,
  paydunya: CreditCard,
  whatsapp: MessageCircle,
  general: Globe,
};

/** Clé VAPID publique : affichée dans sa propre section (lecture seule). */
const VAPID_ENV = "VAPID_PUBLIC_KEY";
/** Remasquage automatique d'un secret affiché. */
const SECRET_AUTO_HIDE_MS = 5000;

export default function IntegrationsPage() {
  useSaCrumbs([{ label: "Paramètres" }, { label: "Intégrations" }]);
  const [data, setData] = useState<IntegrationsPayload | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [showSecret, setShowSecret] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [testingGroup, setTestingGroup] = useState<GroupKey | null>(null);
  const hideTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  useEffect(() => {
    const timers = hideTimers.current;
    return () => {
      Object.values(timers).forEach(clearTimeout);
    };
  }, []);

  const toggleSecret = useCallback((env: string) => {
    const timers = hideTimers.current;
    if (timers[env]) {
      clearTimeout(timers[env]);
      delete timers[env];
    }
    setShowSecret((prev) => {
      const next = !prev[env];
      if (next) {
        timers[env] = setTimeout(() => {
          setShowSecret((s) => ({ ...s, [env]: false }));
          delete timers[env];
        }, SECRET_AUTO_HIDE_MS);
      }
      return { ...prev, [env]: next };
    });
  }, []);

  const hydrate = useCallback((res: IntegrationsPayload) => {
    setData(res);
    const next: Record<string, string> = {};
    for (const f of res.fields || []) {
      next[f.env] = f.value || "";
    }
    setDraft(next);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      hydrate((await superAdminApi.getIntegrations()) as IntegrationsPayload);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Chargement impossible");
    } finally {
      setLoading(false);
    }
  }, [hydrate]);

  useEffect(() => {
    void load();
  }, [load]);

  const dirty = useMemo(() => {
    if (!data?.fields) return false;
    return data.fields.some((f) => !f.readonly && (draft[f.env] ?? "") !== (f.value || ""));
  }, [data, draft]);

  const vapidField = useMemo(() => data?.fields?.find((f) => f.env === VAPID_ENV), [data]);

  async function save() {
    if (!data?.fields) return;
    const patch: Record<string, string> = {};
    for (const f of data.fields) {
      if (f.readonly) continue;
      const d = draft[f.env] ?? "";
      const original = f.value || "";
      if (d === original) continue;
      // Chaîne vide sur secret = conserver (évite d'effacer par erreur).
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
      hydrate(res);
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

  async function regenerateVapid() {
    const ok = window.confirm(
      "Régénérer la paire de clés VAPID ?\n\nTous les abonnements push existants seront invalidés : les utilisateurs devront réactiver les notifications.",
    );
    if (!ok) return;
    setRegenerating(true);
    try {
      const res = (await superAdminApi.regenerateVapid()) as {
        abonnements_invalides?: number;
        warning?: string;
      };
      const n = Number(res?.abonnements_invalides || 0);
      toast.success(`Clés VAPID régénérées · ${n} abonnement(s) push invalidé(s)`);
      if (res?.warning) toast.message(res.warning);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Régénération impossible");
    } finally {
      setRegenerating(false);
    }
  }

  /** Test de connexion par groupe — sans jamais afficher de secret dans les toasts. */
  async function testConnexion(groupKey: GroupKey) {
    setTestingGroup(groupKey);
    try {
      if (groupKey === "whatsapp") {
        const status = (await superAdminApi.whatsappStatus()) as {
          connected?: boolean;
          ready?: boolean;
          state?: string;
          engine?: string;
        };
        const ok = Boolean(status.connected || status.ready);
        if (ok) {
          toast.success("WhatsApp plateforme : session connectée");
        } else {
          toast.error(
            `WhatsApp non connecté${status.state ? ` (${status.state})` : ""}. Ouvre la page WhatsApp pour scanner le QR.`,
          );
        }
        return;
      }

      const res = (await superAdminApi.getIntegrations()) as IntegrationsPayload;
      hydrate(res);
      const meta = res.groups?.[groupKey];

      if (groupKey === "paiement") {
        if (meta?.ready) {
          toast.success(`Paiement configuré (env: ${meta.env || "—"})`);
        } else {
          toast.error("Clés PayTech manquantes — renseigne API_KEY et API_SECRET puis Enregistrer");
        }
        return;
      }

      if (groupKey === "paydunya") {
        if (meta?.ready) {
          toast.success(`PayDunya configuré (mode: ${meta.env || "—"})`);
        } else {
          toast.error("Clés PayDunya incomplètes (MASTER / PRIVATE / TOKEN)");
        }
        return;
      }

      if (groupKey === "general") {
        if (meta?.ready) {
          toast.success("Domaine application configuré");
        } else {
          toast.error("APP_DOMAIN manquant");
        }
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Test impossible");
    } finally {
      setTestingGroup(null);
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
        sousTitre="Paiement en ligne, PayDunya, OpenWA, Web Push et domaine — synchronisés DB + .env + runtime"
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
        const fields = (data?.fields || []).filter((f) => f.group === groupKey && f.env !== VAPID_ENV);
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

            {groupKey === "paydunya" && meta?.provider ? (
              <p className="text-[12px]" style={{ color: "var(--sa-muted)" }}>
                Passerelle active : <strong style={{ color: "var(--sa-text)" }}>{meta.provider}</strong>
              </p>
            ) : null}

            {groupKey === "whatsapp" ? (
              <p className="text-[12px]" style={{ color: "var(--sa-muted)" }}>
                Connexion QR :{" "}
                <Link to="/backoffice/superadmin/whatsapp" className="font-semibold underline" style={{ color: "var(--sa-primary)" }}>
                  WhatsApp plateforme
                </Link>
              </p>
            ) : null}

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={testingGroup === groupKey}
                onClick={() => void testConnexion(groupKey)}
                className="min-h-[36px] px-3 rounded-lg text-[12px] font-semibold inline-flex items-center gap-1.5 disabled:opacity-50"
                style={{ border: "1px solid var(--sa-border)", color: "var(--sa-text)" }}
              >
                {testingGroup === groupKey ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <PlugZap size={14} />
                )}
                Tester la connexion
              </button>
            </div>

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
                      disabled={f.readonly}
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
                      disabled={f.readonly}
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
                        readOnly={f.readonly}
                        onChange={(e) => setDraft((d) => ({ ...d, [f.env]: e.target.value }))}
                      />
                      {f.secret ? (
                        <button
                          type="button"
                          className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5"
                          style={{ color: "var(--sa-muted)" }}
                          onClick={() => toggleSecret(f.env)}
                          aria-label={showSecret[f.env] ? "Masquer" : "Afficher (masquage auto 5 s)"}
                          title={showSecret[f.env] ? "Masquer" : "Afficher (masquage auto 5 s)"}
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

      <section
        className="rounded-xl p-5 space-y-4"
        style={{ background: "var(--sa-surface)", boxShadow: "var(--sa-shadow)" }}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <Bell size={18} className="mt-0.5 shrink-0" style={{ color: "var(--sa-primary)" }} />
            <div>
              <h2 className="text-[15px] font-semibold" style={{ color: "var(--sa-text)" }}>
                Notifications push (VAPID)
              </h2>
              <p className="text-[12px] mt-0.5" style={{ color: "var(--sa-muted)" }}>
                Clé publique du serveur Web Push — lecture seule
              </p>
            </div>
          </div>
          <span
            className="shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold"
            style={{
              background: vapidField?.configured ? "var(--sa-success-bg)" : "var(--sa-warning-bg)",
              color: vapidField?.configured ? "var(--sa-success)" : "var(--sa-warning)",
            }}
          >
            {vapidField?.configured ? "Configuré" : "Non défini"}
          </span>
        </div>

        <label className="block space-y-1">
          <span className="text-[12px] font-semibold" style={{ color: "var(--sa-text)" }}>
            Clé publique VAPID
            {vapidField?.source ? (
              <span className="ml-2 text-[10px] font-normal" style={{ color: "var(--sa-muted)" }}>
                {vapidField.source}
              </span>
            ) : null}
          </span>
          <input
            type="text"
            readOnly
            className="w-full h-11 rounded-lg px-3 text-[12px] font-mono"
            style={{ border: "1px solid var(--sa-border)", background: "var(--sa-bg)", color: "var(--sa-text)" }}
            value={vapidField?.value || ""}
            placeholder="Aucune clé générée"
            spellCheck={false}
          />
        </label>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={regenerating}
            onClick={() => void regenerateVapid()}
            className="min-h-[40px] px-4 rounded-lg text-[13px] font-semibold inline-flex items-center gap-1.5 disabled:opacity-50"
            style={{ border: "1px solid var(--sa-danger)", color: "var(--sa-danger)", background: "transparent" }}
          >
            {regenerating ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            Régénérer les clés
          </button>
          <p className="text-[11px] flex-1 min-w-[200px]" style={{ color: "var(--sa-muted)" }}>
            Action irréversible : tous les abonnements push existants sont invalidés. Pense aussi à mettre à
            jour VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY sur l&apos;hébergeur si définis dans l&apos;environnement.
          </p>
        </div>
      </section>

      {data?.syncedAt ? (
        <p className="text-[11px] text-center" style={{ color: "var(--sa-muted)" }}>
          Dernière sync serveur : {new Date(data.syncedAt).toLocaleString("fr-FR")}
        </p>
      ) : null}
    </div>
  );
}
