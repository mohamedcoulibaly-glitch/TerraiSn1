import { useEffect, useMemo, useState } from 'react';
import { pushApi } from '@/lib/api';
import { useAuth } from '@/hooks/use-auth';
import { usePushNotifications } from '@/hooks/usePushNotifications';

type RoleKey = 'joueur' | 'gerant' | 'proprietaire' | 'super_admin';

const PREFS_BY_ROLE: Record<RoleKey, { key: string; label: string; hint?: string }[]> = {
  joueur: [
    { key: 'push_resa_confirmee', label: 'Confirmations de réservation' },
    { key: 'push_resa_annulee', label: 'Annulations' },
    { key: 'push_rappel_match', label: 'Rappels de match' },
    { key: 'push_remboursement', label: 'Remboursements' },
  ],
  gerant: [
    { key: 'push_nouvelle_resa', label: 'Nouvelles réservations' },
    { key: 'push_match_imminent', label: 'Match imminent — rappel scanner' },
    { key: 'push_reversement', label: 'Virements reçus', hint: 'Terrains à commission' },
    { key: 'push_dette_rappel', label: 'Rappels dette commission', hint: 'Terrains à commission' },
  ],
  proprietaire: [
    { key: 'push_revenus', label: 'Matchs confirmés' },
    { key: 'push_sante_gerant', label: 'Santé gérant' },
    { key: 'push_abonnement', label: 'Abonnement / essai plateforme', hint: 'Terrains abonnement ou essai' },
  ],
  super_admin: [
    { key: 'push_retrait_demande', label: 'Demandes de retrait' },
    { key: 'push_payout_echec', label: 'Payouts en échec' },
    { key: 'push_alertes_terrain', label: 'Alertes terrains' },
    { key: 'push_abonnement', label: 'Abonnements & essais' },
  ],
};

function normalizeRole(role?: string): RoleKey {
  if (role === 'gerant') return 'gerant';
  if (role === 'proprietaire') return 'proprietaire';
  if (role === 'super_admin' || role === 'superadmin') return 'super_admin';
  return 'joueur';
}

type Tokens = { text: string; muted: string; surface: string; border: string; primary: string; danger: string };

const TOKEN_SETS: Record<RoleKey, Tokens> = {
  joueur: {
    text: 'var(--text-primary)',
    muted: 'var(--text-muted)',
    surface: 'var(--color-surface)',
    border: 'var(--color-border)',
    primary: 'var(--color-primary)',
    danger: 'var(--color-danger, #dc2626)',
  },
  gerant: {
    text: 'var(--g-text)',
    muted: 'var(--g-muted)',
    surface: 'var(--g-surface)',
    border: 'var(--g-border)',
    primary: 'var(--g-primary)',
    danger: 'var(--g-danger)',
  },
  proprietaire: {
    text: 'var(--p-text)',
    muted: 'var(--p-muted)',
    surface: 'var(--p-surface)',
    border: 'var(--p-border, var(--p-surface-2))',
    primary: 'var(--p-primary)',
    danger: 'var(--p-verifier)',
  },
  super_admin: {
    text: 'var(--sa-text)',
    muted: 'var(--sa-muted)',
    surface: 'var(--sa-surface)',
    border: 'var(--sa-border)',
    primary: 'var(--sa-primary)',
    danger: 'var(--sa-danger, #dc2626)',
  },
};

type Policies = {
  has_commission?: boolean;
  has_abonnement?: boolean;
  has_achat?: boolean;
  has_essai?: boolean;
  has_sans_avance?: boolean;
  has_remboursement?: boolean;
};

function policySummary(policies?: Policies | null) {
  if (!policies) return null;
  const bits: string[] = [];
  if (policies.has_commission) bits.push('commission');
  if (policies.has_abonnement) bits.push('abonnement');
  if (policies.has_achat) bits.push('achat définitif');
  if (policies.has_essai) bits.push('essai');
  if (policies.has_sans_avance) bits.push('sans avance');
  if (!bits.length) return null;
  return bits.join(' · ');
}

export default function PushPreferencesPanel() {
  const { user } = useAuth();
  const role = normalizeRole(user?.role);
  const tokens = TOKEN_SETS[role];
  const { status, requestPermission, unsubscribe } = usePushNotifications();
  const [prefs, setPrefs] = useState<Record<string, number>>({});
  const [allowed, setAllowed] = useState<Record<string, boolean>>({});
  const [policies, setPolicies] = useState<Policies | null>(null);

  const items = useMemo(() => {
    const all = PREFS_BY_ROLE[role];
    if (!Object.keys(allowed).length) return all;
    return all.filter((item) => allowed[item.key] !== false);
  }, [role, allowed]);

  useEffect(() => {
    if (status !== 'granted') return;
    pushApi
      .getPreferences()
      .then((row) => {
        if (row?.preferences) {
          setPrefs(row.preferences || {});
          setAllowed(row.allowed_preferences || {});
          setPolicies(row.policies || null);
        } else {
          setPrefs(row || {});
          setAllowed({});
          setPolicies(null);
        }
      })
      .catch(() => {});
  }, [status]);

  const toggle = async (key: string, next: boolean) => {
    setPrefs((prev) => ({ ...prev, [key]: next ? 1 : 0 }));
    try {
      const row = await pushApi.updatePreferences({ [key]: next });
      if (row?.preferences) {
        setPrefs(row.preferences);
        setAllowed(row.allowed_preferences || {});
        setPolicies(row.policies || null);
      }
    } catch {
      setPrefs((prev) => ({ ...prev, [key]: next ? 0 : 1 }));
    }
  };

  const statusLabel =
    status === 'granted'
      ? { color: '#16a34a', text: 'Notifications actives sur cet appareil' }
      : status === 'denied'
        ? { color: tokens.danger, text: 'Notifications bloquées par le navigateur' }
        : status === 'unsupported'
          ? { color: tokens.muted, text: 'Non supporté sur cet appareil' }
          : { color: tokens.muted, text: 'Notifications non activées' };

  const policyLine = policySummary(policies);

  return (
    <section className="space-y-4">
      <h2 className="text-sm font-semibold uppercase tracking-wider" style={{ color: tokens.muted }}>
        Notifications push
      </h2>
      <div className="rounded-xl p-4 space-y-3" style={{ background: tokens.surface, border: `1px solid ${tokens.border}` }}>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: statusLabel.color }} />
            <p className="text-sm font-medium" style={{ color: tokens.text }}>
              {statusLabel.text}
            </p>
          </div>
          {status === 'granted' ? (
            <button type="button" onClick={() => unsubscribe()} className="text-xs font-semibold min-h-[44px] px-3 rounded-lg" style={{ color: tokens.danger, border: `1px solid ${tokens.danger}` }}>
              Désactiver
            </button>
          ) : status === 'default' || status === 'loading' ? (
            <button type="button" onClick={() => requestPermission()} className="text-xs font-semibold min-h-[44px] px-3 rounded-lg text-white" style={{ background: tokens.primary }}>
              Activer
            </button>
          ) : null}
        </div>
        {status === 'denied' ? (
          <p className="text-xs" style={{ color: tokens.muted }}>
            Pour les activer, modifie les paramètres de ton navigateur pour ce site.
          </p>
        ) : null}
        {policyLine ? (
          <p className="text-xs" style={{ color: tokens.muted }}>
            Politiques de tes terrains : {policyLine}. Seuls les types correspondants sont proposés.
          </p>
        ) : null}
      </div>

      {status === 'granted' ? (
        <div className="rounded-xl divide-y" style={{ background: tokens.surface, border: `1px solid ${tokens.border}` }}>
          {items.length === 0 ? (
            <p className="p-4 text-sm" style={{ color: tokens.muted }}>
              Aucune notification push applicable à tes politiques terrain actuelles.
            </p>
          ) : (
            items.map((item) => {
              const on = Number(prefs[item.key] ?? 1) === 1;
              return (
                <div key={item.key} className="flex items-center justify-between gap-3 p-4 min-h-[52px]">
                  <div className="min-w-0">
                    <p className="text-sm font-medium" style={{ color: tokens.text }}>
                      {item.label}
                    </p>
                    {item.hint ? (
                      <p className="text-[11px] mt-0.5" style={{ color: tokens.muted }}>
                        {item.hint}
                      </p>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={on}
                    aria-label={item.label}
                    onClick={() => toggle(item.key, !on)}
                    className="relative w-11 h-6 rounded-full shrink-0"
                    style={{ background: on ? tokens.primary : tokens.border }}
                  >
                    <span
                      className="absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform"
                      style={{ transform: on ? 'translateX(22px)' : 'translateX(2px)' }}
                    />
                  </button>
                </div>
              );
            })
          )}
        </div>
      ) : null}
    </section>
  );
}
