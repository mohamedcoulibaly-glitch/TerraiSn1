/**
 * Campagne staging PayTech : vraies créations de lien + IPN signées + cas limites.
 * Usage : node scripts/test-paytech-staging.js
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const crypto = require('crypto');

const API = process.env.API_URL || 'http://localhost:3001';
const JOUEUR_EMAIL = process.env.STAGING_JOUEUR_EMAIL || 'abdou@email.com';
const GERANT_EMAIL = process.env.STAGING_GERANT_EMAIL || 'mohamed.gerant@gmail.com';
const PASSWORD = process.env.STAGING_PASSWORD || 'password123';

const results = [];
let failed = 0;

function log(name, ok, detail = '') {
  results.push({ name, ok, detail: String(detail).slice(0, 280) });
  if (ok) console.log(`OK   ${name}${detail ? ` — ${detail}` : ''}`);
  else {
    failed += 1;
    console.error(`FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

async function req(path, { method = 'GET', token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text.slice(0, 200) };
  }
  return { status: res.status, ok: res.ok, data, text };
}

function ymdPlus(days) {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function shaKey(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function hmacPaytech(amount, ref, apiKey, apiSecret) {
  return crypto.createHmac('sha256', apiSecret).update(`${amount}|${ref}|${apiKey}`).digest('hex');
}

function ipnPayload({ ref, reservationId, amount, type = 'sale_complete', extra = {} }) {
  const apiKey = process.env.PAYTECH_API_KEY;
  const apiSecret = process.env.PAYTECH_API_SECRET;
  return {
    type_event: type,
    ref_command: ref,
    item_price: amount,
    final_item_price: amount,
    env: 'test',
    custom_field: JSON.stringify({ reservation_id: reservationId }),
    api_key_sha256: shaKey(apiKey),
    api_secret_sha256: shaKey(apiSecret),
    hmac_compute: hmacPaytech(amount, ref, apiKey, apiSecret),
    ...extra,
  };
}

async function postIpn(payload, via = 'local') {
  const url = via === 'ngrok'
    ? `${String(process.env.PAYTECH_IPN_URL || '').replace(/\/$/, '')}`
    : `${API}/webhook/paytech`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'ngrok-skip-browser-warning': '1',
    },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok, data };
}

async function login(email, accountType) {
  const r = await req('/api/auth/login', {
    method: 'POST',
    body: { email, password: PASSWORD, accountType },
  });
  if (!r.ok || !r.data.token) {
    throw new Error(`login ${email}: ${r.status} ${r.data.error || JSON.stringify(r.data)}`);
  }
  return { token: r.data.token, user: r.data.user };
}

async function pickSlots(terrainId, count) {
  const slots = [];
  for (let day = 3; day <= 21 && slots.length < count; day += 1) {
    const date = ymdPlus(day);
    const r = await req(`/api/terrains/${terrainId}/creneaux?date=${date}`);
    const list = r.data.creneaux || [];
    for (const c of list) {
      const debut = c.heure_debut || c.heure;
      const fin = c.heure_fin;
      const libre = c.statut === 'libre' || c.disponible === true;
      if (libre && debut && fin && debut !== '00:00') {
        slots.push({ date: c.date || date, heure_debut: debut, heure_fin: fin });
        if (slots.length >= count) break;
      }
    }
  }
  return slots;
}

async function creerResa(token, user, terrainId, slot) {
  return req('/api/reservations', {
    method: 'POST',
    token,
    body: {
      terrain_id: terrainId,
      date: slot.date,
      heure_debut: slot.heure_debut,
      heure_fin: slot.heure_fin,
      joueur_nom: `${user.prenom || 'Mohamed'} ${user.nom || 'Test'}`.trim(),
      joueur_telephone: user.telephone || '778261225',
      format_terrain: 'entier',
      mode: 'paiement',
    },
  });
}

(async () => {
  console.log('\n=== Staging PayTech TerrainSN ===\n');

  if (String(process.env.PAYTECH_MOCK).toLowerCase() === 'true') {
    log('config_pas_mock', false, 'PAYTECH_MOCK=true — pas de vrai staging');
    process.exit(1);
  }
  log('config_env_test', String(process.env.PAYTECH_ENV).toLowerCase() === 'test', process.env.PAYTECH_ENV);
  log('cles_presentes', Boolean(process.env.PAYTECH_API_KEY && process.env.PAYTECH_API_SECRET));

  const unauth = await req('/api/reservations', { method: 'POST', body: {} });
  log('resa_sans_auth_401', unauth.status === 401, unauth.status);

  let joueur;
  try {
    joueur = await login(JOUEUR_EMAIL, 'user');
    log('login_joueur', true, JOUEUR_EMAIL);
  } catch (e) {
    log('login_joueur', false, e.message);
    process.exit(1);
  }

  const terrains = await req('/api/terrains');
  const list = Array.isArray(terrains.data) ? terrains.data : (terrains.data.terrains || []);
  const terrain = list.find((t) => t.id) || list[0];
  log('liste_terrains', Boolean(terrain?.id), terrain ? `${terrain.id} ${terrain.nom}` : 'aucun');
  if (!terrain) process.exit(1);

  const slots = await pickSlots(terrain.id, 14);
  log('creneaux_libres', slots.length >= 9, `${slots.length} slots`);
  if (slots.length < 8) {
    console.error('Pas assez de créneaux libres pour la campagne.');
    process.exit(1);
  }

  const created = [];
  for (let i = 0; i < 7; i += 1) {
    const r = await creerResa(joueur.token, joueur.user, terrain.id, slots[i]);
    const lien = r.data.lien_paiement || r.data.redirect_url;
    const paytech = Boolean(lien && String(lien).includes('paytech.sn'));
    log(
      `lien_paytech_${i + 1}`,
      r.status === 201 && paytech,
      `${r.status} id=${r.data.reservation_id || r.data.id} ${lien || r.data.error || ''}`,
    );
    if (i === 0) {
      log('reponse_joueur_redirect_url', Boolean(r.data.redirect_url || r.data.lien_paiement), Object.keys(r.data).join(','));
    }
    if (r.status === 201) {
      created.push({
        id: r.data.reservation_id || r.data.id,
        ref: r.data.reference_paytech,
        lien,
        avance: Number(r.data.montant_avance),
        slot: slots[i],
        raw: r.data,
      });
    }
  }

  if (created[0]?.lien) {
    const page = await fetch(created[0].lien, { redirect: 'follow' });
    log('checkout_paytech_http', page.ok || page.status < 500, `HTTP ${page.status}`);
  }

  const detail0 = created[0]
    ? await req(`/api/reservations/${created[0].id}`, { token: joueur.token })
    : { data: {} };
  if (created[0] && !created[0].ref) {
    created[0].ref = detail0.data.reference_paytech;
  }
  log('resa_en_attente', detail0.data.statut === 'en_attente', detail0.data.statut);

  // Signature invalide
  const badSig = await postIpn({
    ...ipnPayload({ ref: created[0]?.ref || 'TF-0-x', reservationId: created[0]?.id, amount: created[0]?.avance || 1000 }),
    hmac_compute: '00'.repeat(32),
    api_key_sha256: '11'.repeat(32),
    api_secret_sha256: '22'.repeat(32),
  });
  log('ipn_signature_invalide', badSig.status === 400, badSig.status);

  // Montant sandbox 125 F (vrai comportement PayTech test)
  if (created[0]) {
    const d = await req(`/api/reservations/${created[0].id}`, { token: joueur.token });
    const ref = d.data.reference_paytech;
    const sandbox = await postIpn(ipnPayload({
      ref,
      reservationId: created[0].id,
      amount: 125,
      extra: { initial_item_price: created[0].avance, env: 'test' },
    }));
    const after = await req(`/api/reservations/${created[0].id}`, { token: joueur.token });
    log(
      'ipn_sandbox_100_150_confirme',
      sandbox.ok && after.data.statut === 'confirme' && !sandbox.data.ignored,
      `ipn=${JSON.stringify(sandbox.data)} statut=${after.data.statut}`,
    );
  }

  // Confirmation montant exact
  if (created[1]) {
    const d = await req(`/api/reservations/${created[1].id}`, { token: joueur.token });
    const ref = d.data.reference_paytech;
    const ipn = await postIpn(ipnPayload({
      ref,
      reservationId: created[1].id,
      amount: Number(d.data.montant_avance || created[1].avance),
    }));
    const after = await req(`/api/reservations/${created[1].id}`, { token: joueur.token });
    log(
      'ipn_montant_exact_confirme',
      ipn.ok && after.data.statut === 'confirme',
      `statut=${after.data.statut} code=${after.data.code_reservation || ''}`,
    );

    const replay = await postIpn(ipnPayload({
      ref,
      reservationId: created[1].id,
      amount: Number(d.data.montant_avance || created[1].avance),
    }));
    log('ipn_idempotent', replay.ok && replay.data.received === true, JSON.stringify(replay.data));
  }

  // IPN via ngrok (chemin public réel)
  if (created[2] && process.env.PAYTECH_IPN_URL?.includes('http')) {
    const d = await req(`/api/reservations/${created[2].id}`, { token: joueur.token });
    const ref = d.data.reference_paytech;
    const ipn = await postIpn(
      ipnPayload({ ref, reservationId: created[2].id, amount: Number(d.data.montant_avance) }),
      'ngrok',
    );
    const after = await req(`/api/reservations/${created[2].id}`, { token: joueur.token });
    log(
      'ipn_via_ngrok',
      ipn.ok && after.data.statut === 'confirme',
      `http=${ipn.status} statut=${after.data.statut} ${JSON.stringify(ipn.data).slice(0, 120)}`,
    );
  }

  // Annulation
  if (created[3]) {
    const d = await req(`/api/reservations/${created[3].id}`, { token: joueur.token });
    const ref = d.data.reference_paytech;
    const ipn = await postIpn(ipnPayload({
      ref,
      reservationId: created[3].id,
      amount: Number(d.data.montant_avance),
      type: 'sale_canceled',
    }));
    const after = await req(`/api/reservations/${created[3].id}`, { token: joueur.token });
    log('ipn_annulation', ipn.ok && after.data.statut === 'annule', after.data.statut);
  }

  // Montant incohérent hors sandbox (999999)
  if (created[4]) {
    const d = await req(`/api/reservations/${created[4].id}`, { token: joueur.token });
    const ref = d.data.reference_paytech;
    const ipn = await postIpn(ipnPayload({
      ref,
      reservationId: created[4].id,
      amount: 999999,
    }));
    const after = await req(`/api/reservations/${created[4].id}`, { token: joueur.token });
    log(
      'ipn_montant_incoherent_ignore',
      ipn.ok && ipn.data.reason === 'montant_incoherent' && after.data.statut === 'en_attente',
      `${JSON.stringify(ipn.data)} statut=${after.data.statut}`,
    );
  }

  // Double booking
  const clash = await creerResa(joueur.token, joueur.user, terrain.id, slots[0]);
  log(
    'anti_double_booking',
    clash.status >= 400,
    `${clash.status} ${clash.data.error || ''}`,
  );

  // Mes réservations
  const mes = await req('/api/reservations/mes', { token: joueur.token });
  const mine = mes.data.reservations || mes.data || [];
  log('mes_reservations', Array.isArray(mine) && mine.length >= 1, `${mine.length || 0} lignes`);

  // Gérant
  try {
    const gerant = await login(GERANT_EMAIL, 'employe');
    log('login_gerant', true, GERANT_EMAIL);
    const today = await req('/api/gerant/reservations/today', { token: gerant.token });
    log('gerant_today', today.ok, `http=${today.status}`);
    if (created[1]) {
      const g = await req(`/api/gerant/reservations/${created[1].id}`, { token: gerant.token });
      log('gerant_detail_payee', g.ok && (g.data.statut === 'confirme' || g.data.reservation?.statut === 'confirme'), g.status);
    }
    const gSlot = slots[7];
    const terrainGerant = gerant.user.terrain_id || terrain.id;
    if (gSlot) {
      const gCreate = await req('/api/gerant/reservations', {
        method: 'POST',
        token: gerant.token,
        body: {
          terrain_id: terrainGerant,
          date: gSlot.date,
          heure_debut: gSlot.heure_debut,
          heure_fin: gSlot.heure_fin,
          joueur_nom: 'Walkin Staging',
          joueur_telephone: '778261225',
          mode: 'paiement',
        },
      });
      const gLien = gCreate.data.redirect_url || gCreate.data.lien_paiement || '';
      log(
        'gerant_lien_paytech',
        gCreate.status === 201 && String(gLien).includes('paytech.sn'),
        `${gCreate.status} ${gLien || gCreate.data.error || ''}`,
      );
    }
  } catch (e) {
    log('login_gerant', false, e.message);
  }

  // IPN application/x-www-form-urlencoded (format réel PayTech)
  if (created[5]) {
    const d = await req(`/api/reservations/${created[5].id}`, { token: joueur.token });
    const payload = ipnPayload({
      ref: d.data.reference_paytech,
      reservationId: created[5].id,
      amount: Number(d.data.montant_avance),
    });
    const form = new URLSearchParams();
    for (const [k, v] of Object.entries(payload)) form.set(k, String(v));
    const res = await fetch(`${API}/webhook/paytech`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });
    const data = await res.json().catch(() => ({}));
    const after = await req(`/api/reservations/${created[5].id}`, { token: joueur.token });
    log('ipn_form_urlencoded', res.ok && after.data.statut === 'confirme', `http=${res.status} ${JSON.stringify(data)} statut=${after.data.statut}`);
  }

  if (created[6]) {
    const d = await req(`/api/reservations/${created[6].id}`, { token: joueur.token });
    const ipn = await postIpn(ipnPayload({
      ref: d.data.reference_paytech,
      reservationId: created[6].id,
      amount: Number(d.data.montant_avance),
      type: 'sale_pending',
    }));
    const after = await req(`/api/reservations/${created[6].id}`, { token: joueur.token });
    log(
      'ipn_event_inconnu_ignore',
      ipn.ok && ipn.data.ignored && after.data.statut === 'en_attente',
      JSON.stringify(ipn.data),
    );
  }

  console.log(`\n${results.length} tests, ${failed} échec(s)\n`);
  if (failed) process.exit(1);
  console.log('Campagne staging OK');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
