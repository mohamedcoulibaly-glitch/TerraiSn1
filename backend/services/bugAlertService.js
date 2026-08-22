/**
 * Alertes développeur (e-mail SMTP + WhatsApp session plateforme).
 * Destinataires : BUG_ALERT_EMAILS / BUG_ALERT_WHATSAPP
 * Expéditeur WA : session `platform` connectée depuis le superadmin.
 */
const crypto = require('crypto');
const nodemailer = require('nodemailer');

const THROTTLE_MS = Number(process.env.BUG_ALERT_THROTTLE_MS || 5 * 60 * 1000);
const ENABLED = String(process.env.BUG_ALERT_ENABLED || 'true').toLowerCase() !== 'false';

const KNOWN_DEV_NAMES = {
  '221750147138': 'Babacar SENE',
  '221778261225': 'Mohamed Coulibaly',
};

const KNOWN_EMAIL_NAMES = {
  'babacarec12@gmail.com': 'Babacar SENE',
  'babacarmohamed523@gmail.com': 'Mohamed',
  'mohamedcoulibaly3129@gmail.com': 'Mohamed Coulibaly',
};

/** @type {Map<string, number>} */
const throttle = new Map();

function envList(name) {
  return String(process.env[name] || '')
    .split(/[,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseWhatsappContact(raw) {
  const text = String(raw || '').trim();
  if (!text) return null;
  let phoneRaw = text;
  let name = '';
  for (const sep of [':', '=', '|']) {
    if (text.includes(sep)) {
      const [p, n] = text.split(sep, 2);
      phoneRaw = p.trim();
      name = (n || '').trim();
      break;
    }
  }
  let digits = phoneRaw.replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.length === 9 && digits.startsWith('7')) digits = `221${digits}`;
  if (!digits || digits.length < 10) return null;
  return {
    phone: digits,
    fullName: name || KNOWN_DEV_NAMES[digits] || '',
    firstName: (name || KNOWN_DEV_NAMES[digits] || 'collègue').split(/\s+/)[0],
  };
}

function parseEmailContact(raw) {
  const text = String(raw || '').trim();
  if (!text) return null;
  let email = text;
  let name = '';
  for (const sep of [':', '=', '|']) {
    if (text.includes(sep)) {
      const [e, n] = text.split(sep, 2);
      email = e.trim();
      name = (n || '').trim();
      break;
    }
  }
  email = email.toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  const fullName = name || KNOWN_EMAIL_NAMES[email] || '';
  return {
    email,
    fullName,
    firstName: (fullName || 'collègue').split(/\s+/)[0] || 'collègue',
  };
}

function emailRecipients() {
  return emailContacts().map((c) => c.email);
}

function emailContacts() {
  const seen = new Set();
  const out = [];
  for (const item of envList('BUG_ALERT_EMAILS')) {
    const c = parseEmailContact(item);
    if (!c || seen.has(c.email)) continue;
    seen.add(c.email);
    out.push(c);
  }
  return out;
}

function whatsappContacts() {
  const seen = new Set();
  const out = [];
  for (const item of envList('BUG_ALERT_WHATSAPP')) {
    const c = parseWhatsappContact(item);
    if (!c || seen.has(c.phone)) continue;
    seen.add(c.phone);
    out.push(c);
  }
  return out;
}

function shouldThrottle(key) {
  const now = Date.now();
  const prev = throttle.get(key) || 0;
  if (now - prev < THROTTLE_MS) return true;
  throttle.set(key, now);
  // GC léger
  if (throttle.size > 200) {
    for (const [k, at] of throttle) {
      if (now - at > THROTTLE_MS * 2) throttle.delete(k);
    }
  }
  return false;
}

function throttleKey({ kind, title, error }) {
  const raw = `${kind || 'bug'}:${title || ''}:${error?.name || ''}:${String(error?.message || title || '').slice(0, 180)}`;
  return crypto.createHash('sha1').update(raw).digest('hex').slice(0, 24);
}

function smtpConfigured() {
  return Boolean(process.env.EMAIL_HOST && process.env.EMAIL_HOST_USER && process.env.EMAIL_HOST_PASSWORD);
}

function createTransport() {
  const port = Number(process.env.EMAIL_PORT || 465);
  const useSsl = String(process.env.EMAIL_USE_SSL || 'true').toLowerCase() === 'true';
  const useTls = String(process.env.EMAIL_USE_TLS || 'false').toLowerCase() === 'true';
  return nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port,
    secure: useSsl || port === 465,
    requireTLS: useTls && !useSsl,
    auth: {
      user: process.env.EMAIL_HOST_USER,
      pass: process.env.EMAIL_HOST_PASSWORD,
    },
  });
}

function formatStack(error) {
  if (!error) return '';
  if (error.stack) return String(error.stack).slice(0, 12000);
  return String(error.message || error).slice(0, 2000);
}

function explainProblem({ kind, title, error, req, meta }) {
  const path = req?.originalUrl || req?.url || meta?.path || '';
  const method = req?.method || meta?.method || '';
  const rawMsg = String(error?.message || title || '').trim();
  const k = String(kind || '').toLowerCase();

  if (k === 'openwa' || k === 'whatsapp_infra') {
    const engine = meta?.engine || meta?.localEngine || '';
    const baseUrl = meta?.baseUrl || process.env.OPENWA_BASE_URL || '';
    if (/injoignable|fetch failed|ECONN|ETIMEDOUT|AbortError/i.test(rawMsg)) {
      return {
        resume: 'Le serveur OpenWA distant ne répond plus.',
        detail:
          `TerrainSN n’arrive pas à joindre OpenWA${baseUrl ? ` (${baseUrl})` : ''}. ` +
          `Cause technique : ${rawMsg}. Les notifications WhatsApp via OpenWA sont donc coupées jusqu’au rétablissement.`,
        action:
          'Vérifier https://mywa.tickets-place.net , la clé OPENWA_API_KEY, puis la session WhatsApp plateforme dans le superadmin.',
      };
    }
    if (/HTTP\s*5\d\d|HTTP\s*4\d\d/i.test(rawMsg)) {
      return {
        resume: 'OpenWA renvoie une erreur HTTP.',
        detail: `Le health-check OpenWA a échoué : ${rawMsg}${engine ? ` (moteur local : ${engine})` : ''}.`,
        action: 'Contrôler les logs du serveur OpenWA et l’état des sessions terrainsn-*.',
      };
    }
    return {
      resume: 'Problème WhatsApp / OpenWA détecté.',
      detail: rawMsg || 'La santé WhatsApp de la plateforme est dégradée.',
      action:
        'Ouvrir le superadmin → WhatsApp plateforme, reconnecter le QR si besoin, puis retester l’envoi.',
    };
  }

  if (k === 'uncaughtException' || k === 'unhandledRejection') {
    return {
      resume: 'Le backend a planté sur une erreur non gérée.',
      detail: `${error?.name || 'Error'} : ${rawMsg}`,
      action: 'Corriger la stack ci-dessous et redémarrer l’API si le process est instable.',
    };
  }

  if (k === 'http_error') {
    const status = error?.status || error?.statusCode || meta?.status || '';
    return {
      resume: `Erreur HTTP${status ? ` ${status}` : ''} sur l’API TerrainSN.`,
      detail: `${method} ${path || 'route inconnue'} → ${rawMsg}`,
      action: 'Reproduire la route, vérifier les logs SQL/auth/paiement associés.',
    };
  }

  if (k === 'app_error') {
    const file = meta?.file || 'module inconnu';
    return {
      resume: `Erreur applicative dans ${file}.`,
      detail: rawMsg || title || 'Erreur journalisée par le serveur.',
      action: 'Analyser le fichier indiqué et la stack pour corriger la cause racine.',
    };
  }

  if (k === 'test') {
    return {
      resume: 'Ceci est un test manuel des alertes développeur.',
      detail: rawMsg || 'Aucun incident réel — vérification e-mail / WhatsApp.',
      action: 'Aucune action requise si tu reçois bien ce message.',
    };
  }

  return {
    resume: title || 'Incident TerrainSN',
    detail: rawMsg || 'Un problème a été signalé par le backend.',
    action: 'Consulter le détail technique ci-dessous et intervenir rapidement.',
  };
}

function kindLabel(kind) {
  const map = {
    openwa: 'Panne OpenWA / WhatsApp',
    whatsapp_infra: 'Infra WhatsApp',
    uncaughtException: 'Crash non géré',
    unhandledRejection: 'Promesse rejetée',
    http_error: 'Erreur HTTP API',
    app_error: 'Erreur applicative',
    test: 'Test d’alerte',
    bug: 'Bug',
  };
  return map[String(kind || '').toLowerCase()] || 'Alerte système';
}

function buildBodies({ kind, title, error, req, meta, firstName }) {
  const path = req?.originalUrl || req?.url || meta?.path || 'hors requête';
  const method = req?.method || meta?.method || '';
  const user =
    req?.user?.email ||
    req?.user?.telephone ||
    req?.user?.id ||
    meta?.user ||
    '';
  const when = new Date().toLocaleString('fr-SN', {
    timeZone: 'Africa/Dakar',
    dateStyle: 'full',
    timeStyle: 'medium',
  });
  const explanation = explainProblem({ kind, title, error, req, meta });
  const stack = formatStack(error);
  const realProblem = explanation.detail;
  const prenom = firstName || 'collègue';
  const label = kindLabel(kind);

  const metaUseful = meta
    ? Object.entries(meta)
        .filter(([k]) => !['path', 'method', 'user', 'source'].includes(k))
        .map(([k, v]) => `• ${k} : ${typeof v === 'string' ? v : JSON.stringify(v)}`)
        .join('\n')
    : '';

  const text = [
    `Bonjour ${prenom},`,
    ``,
    `Une alerte TerrainSN vient d’être déclenchée.`,
    ``,
    `=== LE VRAI PROBLÈME ===`,
    explanation.resume,
    realProblem,
    ``,
    `Que faire : ${explanation.action}`,
    ``,
    `Catégorie : ${label}`,
    `Moment : ${when}`,
    path && path !== 'hors requête' ? `Requête : ${method} ${path}` : null,
    user ? `Utilisateur concerné : ${user}` : null,
    metaUseful ? `\nContexte :\n${metaUseful}` : null,
    stack ? `\nDétail technique (stack) :\n${stack}` : null,
    ``,
    `— TerrainSN (alerte automatique développeur)`,
  ]
    .filter((line) => line !== null)
    .join('\n');

  const html = `
  <div style="font-family:Segoe UI,system-ui,sans-serif;max-width:640px;margin:0 auto;color:#0f172a;line-height:1.5">
    <p style="margin:0 0 16px">Bonjour <strong>${escapeHtml(prenom)}</strong>,</p>
    <p style="margin:0 0 16px">Une alerte <strong>TerrainSN</strong> vient d’être déclenchée.</p>

    <div style="background:#fef2f2;border-left:4px solid #dc2626;padding:14px 16px;border-radius:8px;margin:0 0 18px">
      <p style="margin:0 0 6px;font-size:12px;letter-spacing:.04em;text-transform:uppercase;color:#b91c1c;font-weight:700">Le vrai problème</p>
      <p style="margin:0 0 8px;font-size:16px;font-weight:700;color:#991b1b">${escapeHtml(explanation.resume)}</p>
      <p style="margin:0;color:#7f1d1d">${escapeHtml(realProblem)}</p>
    </div>

    <p style="margin:0 0 16px"><strong>Que faire :</strong> ${escapeHtml(explanation.action)}</p>

    <table style="border-collapse:collapse;width:100%;font-size:14px;margin:0 0 16px">
      <tr><td style="padding:6px 0;color:#64748b;width:140px">Catégorie</td><td style="padding:6px 0">${escapeHtml(label)}</td></tr>
      <tr><td style="padding:6px 0;color:#64748b">Moment</td><td style="padding:6px 0">${escapeHtml(when)}</td></tr>
      ${path && path !== 'hors requête' ? `<tr><td style="padding:6px 0;color:#64748b">Requête</td><td style="padding:6px 0">${escapeHtml(`${method} ${path}`)}</td></tr>` : ''}
      ${user ? `<tr><td style="padding:6px 0;color:#64748b">Utilisateur</td><td style="padding:6px 0">${escapeHtml(String(user))}</td></tr>` : ''}
    </table>

    ${metaUseful ? `<p style="margin:0 0 6px;font-weight:600">Contexte</p><pre style="background:#f8fafc;border:1px solid #e2e8f0;padding:12px;border-radius:8px;font-size:12px;white-space:pre-wrap">${escapeHtml(metaUseful)}</pre>` : ''}
    ${stack ? `<p style="margin:16px 0 6px;font-weight:600">Détail technique</p><pre style="background:#0f172a;color:#e2e8f0;padding:12px;border-radius:8px;font-size:11px;overflow:auto;white-space:pre-wrap">${escapeHtml(stack)}</pre>` : ''}

    <p style="margin:20px 0 0;color:#94a3b8;font-size:12px">Message automatique TerrainSN — ne pas répondre à cet e-mail.</p>
  </div>`;

  const wa = [
    `🚨 *TerrainSN — ${label}*`,
    `Bonjour ${prenom},`,
    ``,
    `*Le vrai problème :* ${explanation.resume}`,
    realProblem.slice(0, 400),
    ``,
    `👉 ${explanation.action}`,
    path && path !== 'hors requête' ? `Requête : ${method} ${String(path).slice(0, 100)}` : null,
  ]
    .filter(Boolean)
    .join('\n');

  const subject = `[TerrainSN] ${explanation.resume}`.slice(0, 180);

  return { text, html, wa, subject, explanation };
}

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function sendEmailPersonalized({ kind, title, error, req, meta }) {
  const contacts = emailContacts();
  if (!smtpConfigured() || !contacts.length) {
    return { ok: false, reason: 'smtp_or_recipients_missing', sent: 0 };
  }
  const from =
    process.env.DEFAULT_FROM_EMAIL ||
    process.env.PLATFORM_NOTIFICATION_EMAIL ||
    process.env.EMAIL_HOST_USER;
  const transport = createTransport();
  let sent = 0;
  const errors = [];
  for (const contact of contacts) {
    try {
      const bodies = buildBodies({
        kind,
        title,
        error,
        req,
        meta,
        firstName: contact.firstName,
      });
      await transport.sendMail({
        from,
        to: contact.email,
        subject: bodies.subject.slice(0, 240),
        text: bodies.text,
        html: bodies.html,
      });
      sent += 1;
    } catch (err) {
      errors.push(`${contact.email}: ${err.message || err}`);
    }
  }
  return { ok: sent > 0, sent, errors };
}

async function sendWhatsAppPersonalized({ kind, title, error, req, meta }) {
  const contacts = whatsappContacts();
  if (!contacts.length) return { ok: false, reason: 'no_wa_recipients', sent: 0 };

  const whatsappClient = require('../whatsappClient');
  const status = await whatsappClient.getStatus('platform').catch(() => null);
  if (!status?.connected) {
    return { ok: false, reason: 'platform_whatsapp_disconnected', sent: 0 };
  }

  const senderDigits = String(status.phone || '').replace(/\D/g, '');
  let sent = 0;
  const errors = [];
  for (const contact of contacts) {
    if (senderDigits && contact.phone === senderDigits) continue;
    try {
      const bodies = buildBodies({
        kind,
        title,
        error,
        req,
        meta,
        firstName: contact.firstName,
      });
      await whatsappClient.sendTextForSession('platform', `${contact.phone}@c.us`, bodies.wa);
      sent += 1;
    } catch (err) {
      errors.push(`${contact.phone}: ${err.message || err}`);
    }
  }
  return { ok: sent > 0, sent, errors };
}

/**
 * @param {{ kind?: string, title?: string, error?: Error|string|null, req?: any, meta?: object, force?: boolean }} opts
 */
async function notify(opts = {}) {
  if (!ENABLED && !opts.force) return { ok: false, skipped: 'disabled' };

  const error =
    opts.error instanceof Error
      ? opts.error
      : opts.error
        ? new Error(String(opts.error))
        : null;
  const kind = opts.kind || 'bug';
  const title = opts.title || error?.message || 'Alerte TerrainSN';
  const key = throttleKey({ kind, title, error });
  if (!opts.force && shouldThrottle(key)) {
    return { ok: false, skipped: 'throttled', key };
  }

  const bodiesPreview = buildBodies({
    kind,
    title,
    error,
    req: opts.req,
    meta: opts.meta,
    firstName: 'collègue',
  });

  const result = { key, email: null, whatsapp: null, subject: bodiesPreview.subject };

  try {
    result.email = await sendEmailPersonalized({
      kind,
      title,
      error,
      req: opts.req,
      meta: opts.meta,
    });
  } catch (err) {
    result.email = { ok: false, error: err.message || String(err) };
    console.error('❌ Bug alert email:', err.message || err);
  }

  try {
    result.whatsapp = await sendWhatsAppPersonalized({
      kind,
      title,
      error,
      req: opts.req,
      meta: opts.meta,
    });
  } catch (err) {
    result.whatsapp = { ok: false, error: err.message || String(err) };
    console.error('❌ Bug alert WhatsApp:', err.message || err);
  }

  const ok = Boolean(result.email?.ok || result.whatsapp?.ok);
  if (ok) {
    console.log(
      `📣 Bug alert envoyée [${kind}] email=${result.email?.ok ? 'ok' : 'ko'} wa=${result.whatsapp?.ok ? 'ok' : result.whatsapp?.reason || 'ko'}`,
    );
  }
  return { ok, ...result };
}

/** Alerte dédiée infra WhatsApp / OpenWA (throttle séparé). */
async function notifyWhatsappInfra(detail, meta = {}) {
  return notify({
    kind: 'openwa',
    title: 'WhatsApp / OpenWA indisponible',
    error: new Error(String(detail || 'Infra WhatsApp KO')),
    meta: { ...meta, source: 'whatsapp_infra' },
  });
}

async function checkWhatsappHealthAndAlert() {
  try {
    const whatsappClient = require('../whatsappClient');
    const health = await whatsappClient.getHealth();

    // Probe OpenWA distant même si l’appairage local est en Baileys
    const apiKey = String(process.env.OPENWA_API_KEY || '').trim();
    const baseUrl = String(process.env.OPENWA_BASE_URL || 'https://mywa.tickets-place.net').replace(/\/$/, '');
    if (apiKey) {
      try {
        const probe = await fetch(`${baseUrl}/api/infra/health`, {
          headers: { 'X-API-Key': apiKey, Accept: 'application/json' },
          signal: AbortSignal.timeout(8000),
        });
        if (!probe.ok) {
          await notifyWhatsappInfra(`OpenWA HTTP ${probe.status}`, {
            baseUrl,
            localEngine: health?.engine,
          });
        }
      } catch (err) {
        await notifyWhatsappInfra(`OpenWA injoignable: ${err.message || err}`, {
          baseUrl,
          localEngine: health?.engine,
        });
      }
    }

    if (health?.ok === false) {
      await notifyWhatsappInfra(health.message || 'getHealth ok=false', {
        engine: health.engine,
        connected: health.connected,
      });
    }

    const status = await whatsappClient.getStatus('platform');
    if (!status?.connected && status?.error && !status?.hasQr && !status?.initializing) {
      await notifyWhatsappInfra(status.error, {
        provider: status.provider,
        waState: status.waState,
      });
    }
    return { health, status };
  } catch (err) {
    await notifyWhatsappInfra(err.message || err, { phase: 'health_check' });
    return null;
  }
}

function installProcessHandlers() {
  process.on('uncaughtException', (err) => {
    console.error('uncaughtException', err);
    notify({
      kind: 'uncaughtException',
      title: 'uncaughtException',
      error: err,
    }).catch(() => {});
  });
  process.on('unhandledRejection', (reason) => {
    const err = reason instanceof Error ? reason : new Error(String(reason));
    console.error('unhandledRejection', err);
    notify({
      kind: 'unhandledRejection',
      title: 'unhandledRejection',
      error: err,
    }).catch(() => {});
  });
}

function expressErrorMiddleware(err, req, res, next) {
  notify({
    kind: 'http_error',
    title: `HTTP ${err.status || err.statusCode || 500}`,
    error: err,
    req,
  }).catch(() => {});
  if (res.headersSent) return next(err);
  const status = err.status || err.statusCode || 500;
  if (status >= 500) {
    return res.status(status).json({
      error: process.env.NODE_ENV === 'production' ? 'Erreur serveur' : err.message || 'Erreur serveur',
    });
  }
  return res.status(status).json({ error: err.message || 'Erreur' });
}

module.exports = {
  notify,
  notifyWhatsappInfra,
  checkWhatsappHealthAndAlert,
  installProcessHandlers,
  expressErrorMiddleware,
  emailRecipients,
  emailContacts,
  whatsappContacts,
  smtpConfigured,
};
