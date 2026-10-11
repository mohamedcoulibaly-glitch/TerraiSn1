/**
 * Secrets / config d’intégrations (paiement en ligne + OpenWA).
 * Source de vérité : plateforme_settings (DB) → process.env → fichier .env.
 * Les valeurs DB écrasent l’env au démarrage et après chaque sauvegarde admin.
 */
const fs = require('fs');
const path = require('path');
const { queryOne, runSql } = require('../database');

const SETTING_PREFIX = 'integration.';
const ENV_PATH = path.join(__dirname, '..', '.env');

/** @typedef {'paiement'|'paydunya'|'whatsapp'|'general'} IntegrationGroup */

/**
 * @type {Array<{
 *   env: string,
 *   group: IntegrationGroup,
 *   secret?: boolean,
 *   label: string,
 *   hint?: string,
 *   type?: 'text'|'password'|'select'|'boolean',
 *   options?: string[],
 *   readonly?: boolean,
 * }>}
 */
const MANAGED = [
  {
    env: 'PAYTECH_API_KEY',
    group: 'paiement',
    secret: true,
    type: 'password',
    label: 'Clé API',
    hint: 'Clé publique de la passerelle de paiement',
  },
  {
    env: 'PAYTECH_API_SECRET',
    group: 'paiement',
    secret: true,
    type: 'password',
    label: 'Clé secrète',
    hint: 'Ne jamais partager — utilisée pour signer les webhooks',
  },
  {
    env: 'PAYTECH_ENV',
    group: 'paiement',
    type: 'select',
    options: ['test', 'prod'],
    label: 'Environnement',
    hint: 'test = sandbox · prod = paiements réels',
  },
  {
    env: 'PAYTECH_BASE_URL',
    group: 'paiement',
    type: 'text',
    label: 'URL API paiement',
    hint: 'Laisser vide pour l’URL API par défaut',
  },
  {
    env: 'PAYTECH_IPN_URL',
    group: 'paiement',
    type: 'text',
    label: 'URL IPN (webhook)',
  },
  {
    env: 'PAYTECH_SUCCESS_URL',
    group: 'paiement',
    type: 'text',
    label: 'URL succès',
  },
  {
    env: 'PAYTECH_CANCEL_URL',
    group: 'paiement',
    type: 'text',
    label: 'URL annulation',
  },
  {
    env: 'PAYTECH_PAYOUT_ENABLED',
    group: 'paiement',
    type: 'boolean',
    label: 'Reversements automatiques',
    hint: 'true / false — envoi auto du dû gérant',
  },
  {
    env: 'PAYMENT_MODE',
    group: 'paiement',
    type: 'select',
    options: ['production', 'simulation'],
    label: 'Mode paiement',
    hint: 'production = PayTech réel (joueur). simulation = page locale hors réservation joueur uniquement',
  },
  {
    env: 'PAYMENT_PROVIDER',
    group: 'paiement',
    type: 'select',
    options: ['paytech', 'paydunya'],
    label: 'Passerelle active',
    hint: 'paytech ou paydunya — passerelle utilisée pour les paiements en ligne',
  },
  // ─── PayDunya (groupe dédié) ───
  {
    env: 'PAYDUNYA_MODE',
    group: 'paydunya',
    type: 'select',
    options: ['test', 'live'],
    label: 'Mode PayDunya',
    hint: 'test = sandbox · live = paiements réels',
  },
  {
    env: 'PAYDUNYA_STORE_NAME',
    group: 'paydunya',
    type: 'text',
    label: 'Nom de la boutique',
  },
  {
    env: 'PAYDUNYA_MASTER_KEY',
    group: 'paydunya',
    secret: true,
    type: 'password',
    label: 'Master key',
  },
  {
    env: 'PAYDUNYA_PUBLIC_KEY',
    group: 'paydunya',
    secret: true,
    type: 'password',
    label: 'Clé publique',
  },
  {
    env: 'PAYDUNYA_PRIVATE_KEY',
    group: 'paydunya',
    secret: true,
    type: 'password',
    label: 'Clé privée',
    hint: 'Ne jamais partager',
  },
  {
    env: 'PAYDUNYA_TOKEN',
    group: 'paydunya',
    secret: true,
    type: 'password',
    label: 'Token',
  },
  {
    env: 'PAYDUNYA_CALLBACK_URL',
    group: 'paydunya',
    type: 'text',
    label: 'URL callback / IPN',
    hint: 'Laisser vide pour dériver de APP_DOMAIN (/webhook/paydunya)',
  },
  {
    env: 'PAYDUNYA_RETURN_URL',
    group: 'paydunya',
    type: 'text',
    label: 'URL retour (succès)',
  },
  {
    env: 'PAYDUNYA_CANCEL_URL',
    group: 'paydunya',
    type: 'text',
    label: 'URL annulation',
  },
  {
    env: 'PAYDUNYA_PAYOUT_ENABLED',
    group: 'paydunya',
    type: 'boolean',
    label: 'Reversements automatiques PayDunya',
    hint: 'true / false',
  },
  {
    env: 'PAYDUNYA_PAYOUT_CALLBACK_URL',
    group: 'paydunya',
    type: 'text',
    label: 'URL callback reversements',
  },
  {
    env: 'PAYDUNYA_DISBURSE_USE_SANDBOX',
    group: 'paydunya',
    type: 'boolean',
    label: 'Sandbox pour les reversements',
    hint: 'true = API disburse sandbox (mode test uniquement)',
  },
  // ─── Web Push ───
  {
    env: 'VAPID_PUBLIC_KEY',
    group: 'general',
    type: 'text',
    readonly: true,
    label: 'Clé publique VAPID (Web Push)',
    hint: 'Lecture seule — régénérer via POST /api/admin/integrations/vapid/regenerate',
  },
  {
    env: 'OPENWA_BASE_URL',
    group: 'whatsapp',
    type: 'text',
    label: 'URL serveur OpenWA',
  },
  {
    env: 'OPENWA_API_KEY',
    group: 'whatsapp',
    secret: true,
    type: 'password',
    label: 'Clé API OpenWA',
  },
  {
    env: 'OPENWA_SESSION_PREFIX',
    group: 'whatsapp',
    type: 'text',
    label: 'Préfixe de session',
  },
  {
    env: 'OPENWA_SHARED_SESSION_ID',
    group: 'whatsapp',
    secret: true,
    type: 'password',
    label: 'Session partagée (UUID)',
    hint: 'Optionnel — session OpenWA déjà connectée',
  },
  {
    env: 'OPENWA_PLATFORM_SESSION_ID',
    group: 'whatsapp',
    secret: true,
    type: 'password',
    label: 'Session plateforme (UUID)',
  },
  {
    env: 'WHATSAPP_MOCK',
    group: 'whatsapp',
    type: 'boolean',
    label: 'Mode simulation WhatsApp',
    hint: 'true = aucun envoi réel',
  },
  {
    env: 'WHATSAPP_DEV_NUMBER',
    group: 'whatsapp',
    type: 'text',
    label: 'Numéro équipe dév',
  },
  {
    env: 'WHATSAPP_TEST_NUMBER',
    group: 'whatsapp',
    type: 'text',
    label: 'Numéro de test',
  },
  {
    env: 'APP_DOMAIN',
    group: 'general',
    type: 'text',
    label: 'Domaine application',
    hint: 'Ex. https://ton-domaine.sn ou http://localhost:8080',
  },
];

function settingCle(envKey) {
  return `${SETTING_PREFIX}${envKey}`;
}

function readDbValue(db, envKey) {
  try {
    const row = queryOne(db, 'SELECT valeur FROM plateforme_settings WHERE cle = ?', [settingCle(envKey)]);
    if (row == null || row.valeur == null) return null;
    return String(row.valeur);
  } catch {
    return null;
  }
}

function writeDbValue(db, envKey, value) {
  const cle = settingCle(envKey);
  const existing = queryOne(db, 'SELECT cle FROM plateforme_settings WHERE cle = ?', [cle]);
  if (existing) {
    runSql(db, 'UPDATE plateforme_settings SET valeur = ?, updated_at = CURRENT_TIMESTAMP WHERE cle = ?', [
      value,
      cle,
    ]);
  } else {
    runSql(db, 'INSERT INTO plateforme_settings (cle, valeur) VALUES (?, ?)', [cle, value]);
  }
}

function maskSecret(value) {
  const s = String(value || '');
  if (!s) return { configured: false, preview: '', last4: '' };
  const last4 = s.slice(-4);
  return {
    configured: true,
    preview: `${'•'.repeat(Math.min(12, Math.max(4, s.length - 4)))}${last4}`,
    last4,
  };
}

function effectiveValue(db, envKey) {
  const fromDb = readDbValue(db, envKey);
  if (fromDb != null && fromDb !== '') return { value: fromDb, source: 'database' };
  const fromEnv = process.env[envKey];
  if (fromEnv != null && String(fromEnv) !== '') {
    return { value: String(fromEnv), source: 'env' };
  }
  return { value: '', source: 'unset' };
}

function applyToProcessEnv(envKey, value) {
  if (value == null || value === '') {
    delete process.env[envKey];
  } else {
    process.env[envKey] = String(value);
  }
}

/**
 * Si une clé n’existe pas encore en DB mais est présente en .env, la copie en DB
 * pour que l’UI et le runtime partagent la même source.
 */
function seedMissingFromEnv(db) {
  let seeded = 0;
  for (const field of MANAGED) {
    if (field.readonly) continue;
    const fromDb = readDbValue(db, field.env);
    if (fromDb != null && fromDb !== '') continue;
    const fromEnv = process.env[field.env];
    if (fromEnv == null || String(fromEnv).trim() === '') continue;
    writeDbValue(db, field.env, String(fromEnv).trim());
    seeded += 1;
  }
  return seeded;
}

/**
 * Charge les overrides DB dans process.env (DB gagne).
 * @returns {{ applied: number, seeded: number, overridden: string[] }}
 */
function hydrateFromDb(db) {
  const seeded = seedMissingFromEnv(db);
  let applied = 0;
  const overridden = [];
  const envMirror = {};
  for (const field of MANAGED) {
    if (field.readonly) continue;
    const fromDb = readDbValue(db, field.env);
    if (fromDb != null && fromDb !== '') {
      const fromEnv = process.env[field.env];
      if (
        fromEnv
        && String(fromEnv).trim() !== ''
        && String(fromEnv).trim() !== String(fromDb).trim()
      ) {
        overridden.push(field.env);
      }
      applyToProcessEnv(field.env, fromDb);
      envMirror[field.env] = String(fromDb);
      applied += 1;
    }
  }
  // Garde .env aligné avec la DB (source de vérité superadmin) pour ne pas
  // réintroduire une ancienne config au prochain redémarrage local.
  if (Object.keys(envMirror).length) {
    try {
      syncEnvFile(envMirror);
    } catch (err) {
      console.warn(`[integrations] sync .env au demarrage: ${err.message}`);
    }
  }
  if (overridden.length) {
    console.warn(
      `[integrations] DB ecrase .env pour: ${overridden.join(', ')} `
        + '(mettre a jour via superadmin /integrations, pas seulement .env)',
    );
  }
  return { applied, seeded, overridden };
}

/**
 * Upsert des clés dans backend/.env (préserve le reste du fichier).
 */
function syncEnvFile(updates) {
  const entries = Object.entries(updates || {}).filter(([, v]) => v != null);
  if (!entries.length) return { ok: true, written: 0 };

  let content = '';
  try {
    content = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, 'utf8') : '';
  } catch {
    content = '';
  }

  const lines = content.length ? content.split(/\r?\n/) : [];
  const seen = new Set();
  const nextLines = lines.map((line) => {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (!m) return line;
    const key = m[1];
    if (!(key in updates)) return line;
    seen.add(key);
    return `${key}=${updates[key]}`;
  });

  for (const [key, value] of entries) {
    if (seen.has(key)) continue;
    if (nextLines.length && nextLines[nextLines.length - 1] !== '') nextLines.push('');
    nextLines.push(`${key}=${value}`);
  }

  fs.writeFileSync(ENV_PATH, `${nextLines.join('\n').replace(/\n+$/, '')}\n`, 'utf8');
  return { ok: true, written: entries.length };
}

function describe(db) {
  const fields = MANAGED.map((field) => {
    let { value, source } = field.readonly
      ? { value: '', source: 'unset' }
      : effectiveValue(db, field.env);
    if (field.readonly && field.env === 'VAPID_PUBLIC_KEY') {
      // Lecture seule : clé effective du serveur Web Push (env / fichier / auto-générée)
      try {
        const push = require('../pushService');
        value = String(push.getPublicKey() || process.env.VAPID_PUBLIC_KEY || '');
        const info = push.describe();
        source = value ? (info.source || 'env') : 'unset';
      } catch {
        value = String(process.env.VAPID_PUBLIC_KEY || '');
        source = value ? 'env' : 'unset';
      }
    }
    const base = {
      env: field.env,
      group: field.group,
      label: field.label,
      hint: field.hint || null,
      type: field.type || (field.secret ? 'password' : 'text'),
      options: field.options || null,
      readonly: Boolean(field.readonly),
      secret: Boolean(field.secret),
      source,
      configured: Boolean(value),
    };
    // Superadmin authentifié : on renvoie la valeur réelle pour affichage / édition.
    // `preview` reste masqué pour les badges UI.
    if (field.secret) {
      const masked = maskSecret(value);
      return { ...base, value, preview: masked.preview, last4: masked.last4 };
    }
    return { ...base, value, preview: value, last4: value ? String(value).slice(-4) : '' };
  });

  const paymentConfigured = Boolean(
    String(process.env.PAYTECH_API_KEY || '').trim()
      && String(process.env.PAYTECH_API_SECRET || '').trim(),
  );
  const openwaConfigured = Boolean(String(process.env.OPENWA_API_KEY || '').trim());
  const paydunyaConfigured = Boolean(
    String(process.env.PAYDUNYA_MASTER_KEY || '').trim()
      && String(process.env.PAYDUNYA_PRIVATE_KEY || '').trim()
      && String(process.env.PAYDUNYA_TOKEN || '').trim(),
  );

  return {
    fields,
    groups: {
      paiement: {
        title: 'Paiement en ligne',
        subtitle: 'Clés Wave / Orange Money (passerelle)',
        ready: paymentConfigured,
        env: process.env.PAYTECH_ENV || 'test',
      },
      paydunya: {
        title: 'PayDunya',
        subtitle: 'Master key, clés API, token et reversements',
        ready: paydunyaConfigured,
        env: process.env.PAYDUNYA_MODE || 'test',
        provider: String(process.env.PAYMENT_PROVIDER || process.env.PAYMENT_GATEWAY || 'paytech').toLowerCase(),
      },
      whatsapp: {
        title: 'WhatsApp OpenWA',
        subtitle: 'Serveur, clé API et sessions',
        ready: openwaConfigured,
        mock: String(process.env.WHATSAPP_MOCK || '').toLowerCase() === 'true',
      },
      general: {
        title: 'Général',
        subtitle: 'Domaine public de l’application',
        ready: Boolean(String(process.env.APP_DOMAIN || '').trim()),
      },
    },
    syncedAt: new Date().toISOString(),
  };
}

/**
 * Enregistre un patch. Chaîne vide / null / undefined = conserver la valeur actuelle.
 * Booléens acceptés comme true/false/1/0/"true"/"false".
 */
function save(db, patch = {}) {
  const body = patch && typeof patch === 'object' ? patch : {};
  const envUpdates = {};
  const changed = [];

  for (const field of MANAGED) {
    if (field.readonly) continue; // affichage seul (ex. VAPID_PUBLIC_KEY)
    if (!Object.prototype.hasOwnProperty.call(body, field.env)) continue;
    let raw = body[field.env];
    if (raw == null) continue;
    if (typeof raw === 'string' && raw.trim() === '') continue; // garder l’existant

    if (field.type === 'boolean') {
      const normalized = String(raw).toLowerCase().trim();
      if (['1', 'true', 'oui', 'yes', 'on'].includes(normalized)) raw = 'true';
      else if (['0', 'false', 'non', 'no', 'off'].includes(normalized)) raw = 'false';
      else {
        const error = new Error(`${field.label} : valeur booléenne invalide`);
        error.statusCode = 400;
        throw error;
      }
    }

    if (field.type === 'select' && field.options?.length) {
      const v = String(raw).toLowerCase().trim();
      if (!field.options.includes(v)) {
        const error = new Error(`${field.label} : valeur invalide (attendu : ${field.options.join(' | ')})`);
        error.statusCode = 400;
        throw error;
      }
      raw = v;
    }

    const value = String(raw).trim();
    writeDbValue(db, field.env, value);
    applyToProcessEnv(field.env, value);
    envUpdates[field.env] = value;
    changed.push(field.env);
  }

  let envFile = { ok: true, written: 0 };
  if (Object.keys(envUpdates).length) {
    try {
      envFile = syncEnvFile(envUpdates);
    } catch (err) {
      envFile = { ok: false, written: 0, error: err.message };
    }
  }

  let whatsappReloaded = false;
  const whatsappTouched = changed.some(
    (k) => k.startsWith('OPENWA_') || k.startsWith('WHATSAPP_'),
  );
  if (whatsappTouched) {
    try {
      const wa = require('../whatsappClient');
      if (typeof wa.reloadConfig === 'function') {
        wa.reloadConfig();
        whatsappReloaded = true;
      }
    } catch {
      /* ignore */
    }
  }

  return {
    ...describe(db),
    changed,
    envFile,
    whatsappReloaded,
  };
}

module.exports = {
  MANAGED,
  hydrateFromDb,
  describe,
  save,
  syncEnvFile,
  effectiveValue,
};
