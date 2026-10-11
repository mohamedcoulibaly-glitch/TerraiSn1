/**
 * Flux critiques merge-final (simulation / WhatsApp mock).
 * Usage (serveur déjà lancé sur PORT) :
 *   node scripts/verify-merge-flux.js
 */
const http = require('http');

const PORT = Number(process.env.PORT || 3001);
const BASE = `http://127.0.0.1:${PORT}`;

function req(method, path, { token, body, headers } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
    const data = body != null ? JSON.stringify(body) : null;
    const r = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(headers || {}),
          ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          let json = null;
          try {
            json = JSON.parse(raw);
          } catch {
            /* ignore */
          }
          resolve({ status: res.statusCode, json, raw: raw.slice(0, 500) });
        });
      },
    );
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

function ok(name, cond, detail) {
  console.log(`${cond ? 'OK   ' : 'FAIL '} ${name}${detail != null ? ` — ${detail}` : ''}`);
  return Boolean(cond);
}

async function main() {
  let fails = 0;
  const fail = (n, c, d) => {
    if (!ok(n, c, d)) fails += 1;
  };

  // Health
  const health = await req('GET', '/api/health');
  fail('health', health.status === 200, `status=${health.status}`);

  // FLUX 1 — register + otp (mock)
  const phone = `77${String(Date.now()).slice(-7)}`;
  const reg = await req('POST', '/api/auth/register', {
    body: { prenom: 'Flux', nom: 'Merge', telephone: phone, password: 'TestMerge1!' },
  });
  fail('F1 register', reg.status === 200 || reg.status === 201, `status=${reg.status} ${reg.raw}`);

  // Récupérer OTP depuis DB via endpoint resend + mock logs — on verify avec code depuis auth_otps via script interne
  const { getDb, queryOne } = require('../database');
  const db = await getDb();
  const otpRow = queryOne(
    db,
    `SELECT code FROM auth_otps WHERE telephone LIKE ? ORDER BY id DESC LIMIT 1`,
    [`%${phone.slice(-9)}`],
  );
  fail('F1 otp en DB', Boolean(otpRow?.code), otpRow?.code);

  const ver = await req('POST', '/api/auth/verify-otp', {
    body: { telephone: phone, code: String(otpRow?.code || '') },
  });
  const joueurToken = ver.json?.accessToken || ver.json?.token;
  const joueurUser = ver.json?.user || {};
  fail('F1 verify-otp JWT', ver.status === 200 && Boolean(joueurToken), `status=${ver.status}`);
  fail('F1 JWT role joueur', joueurUser.role === 'joueur' || ver.json?.role === 'joueur', JSON.stringify(joueurUser.role || ver.json?.role));
  fail('F1 JWT id', Boolean(joueurUser.id || ver.json?.id));

  // Decode JWT payload (no verify)
  const payload = JSON.parse(Buffer.from(String(joueurToken).split('.')[1], 'base64url').toString());
  fail('F1 JWT payload fields', payload.id && payload.role === 'joueur' && (payload.telephone || payload.tel), JSON.stringify({ id: payload.id, role: payload.role, telephone: payload.telephone }));

  // FLUX 2 — backoffice logins (comptes seed Mohamed si présents)
  const tryLogin = async (label, body, expectRole) => {
    const r = await req('POST', '/api/backoffice/auth/login', { body });
    const tok = r.json?.accessToken || r.json?.token;
    const role = r.json?.user?.role;
    fail(`F2 ${label} status`, r.status === 200, `status=${r.status} ${r.raw}`);
    if (expectRole) fail(`F2 ${label} role`, role === expectRole || role === 'superadmin', `role=${role}`);
    return tok;
  };

  // Joueur sur backoffice → refusé
  const joueurBo = await req('POST', '/api/backoffice/auth/login', {
    body: { telephone: phone, password: 'TestMerge1!' },
  });
  fail('F2 joueur refusés BO', joueurBo.status === 403 || joueurBo.status === 401 || joueurBo.status === 400, `status=${joueurBo.status}`);

  // Comptes seed officiels (ensure-mohamed / seed.js) — password123
  let gToken = null;
  {
    const r = await req('POST', '/api/backoffice/auth/login', {
      body: { email: 'mohamed.gerant@gmail.com', password: 'password123' },
    });
    gToken = r.json?.accessToken || r.json?.token;
    fail('F2 gerant', r.status === 200 && Boolean(gToken), `status=${r.status} role=${r.json?.user?.role}`);
  }

  let pToken = null;
  {
    const r = await req('POST', '/api/backoffice/auth/login', {
      body: { email: 'diop@terrainsn.sn', password: 'password123' },
    });
    pToken = r.json?.accessToken || r.json?.token;
    fail('F2 proprietaire', r.status === 200 && (r.json?.user?.role === 'proprietaire'), `status=${r.status} role=${r.json?.user?.role}`);
  }

  let saToken = null;
  {
    const saLogin = await req('POST', '/api/admin/auth/login', {
      body: { telephone: '+221 70 000 00 00', password: 'password123' },
    });
    saToken = saLogin.json?.token || saLogin.json?.accessToken;
    fail('F2 superadmin', saLogin.status === 200 && Boolean(saToken), `status=${saLogin.status} ${saLogin.raw}`);
  }

  // FLUX 3 — terrains
  const terrains = await req('GET', '/api/terrains');
  fail('F3 liste terrains', terrains.status === 200 && Array.isArray(terrains.json || terrains.json?.terrains || []), `status=${terrains.status}`);
  const list = Array.isArray(terrains.json) ? terrains.json : terrains.json?.terrains || [];
  fail('F3 non vide', list.length > 0, `n=${list.length}`);
  const t0 = list[0] || {};
  fail('F3 photos', t0.photos != null || t0.photo_url != null || t0.photo != null, Object.keys(t0).slice(0, 12).join(','));
  fail('F3 lat/lng', t0.latitude != null || t0.lat != null, `lat=${t0.latitude}`);
  const tid = t0.id;
  if (tid) {
    const today = new Date().toISOString().slice(0, 10);
    const cr = await req('GET', `/api/terrains/${tid}/creneaux?date=${today}`);
    fail('F3 creneaux', cr.status === 200, `status=${cr.status}`);
    const slots = cr.json?.creneaux || cr.json || [];
    const sample = Array.isArray(slots) ? slots[0] : null;
    if (sample) {
      fail('F3 duree_minutes', sample.duree_minutes != null || sample.heure_fin != null, JSON.stringify(sample).slice(0, 120));
    } else {
      ok('F3 creneaux sample', true, 'aucun créneau aujourd\'hui (ok selon horaires)');
    }
  }

  // FLUX 4 — réservation simulation
  if (tid && joueurToken) {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    while (tomorrow.getDay() === 0) tomorrow.setDate(tomorrow.getDate() + 1);
    const date = tomorrow.toISOString().slice(0, 10);
    const cr2 = await req('GET', `/api/terrains/${tid}/creneaux?date=${date}`);
    const slots = (cr2.json?.creneaux || cr2.json || []).filter((c) => c.disponible !== false && (c.statut === 'libre' || !c.statut));
    const slot = slots[0];
    if (!slot) {
      ok('F4 skip résa', true, 'pas de créneau libre demain');
    } else {
      const resa = await req('POST', '/api/reservations', {
        token: joueurToken,
        body: {
          terrain_id: tid,
          date,
          heure_debut: slot.heure_debut || slot.heure,
          heure_fin: slot.heure_fin,
          joueur_nom: 'Flux Merge',
          joueur_telephone: phone,
          format_terrain: 'entier',
        },
      });
      fail('F4 create resa', resa.status === 200 || resa.status === 201, `status=${resa.status} ${resa.raw}`);
      const rid = resa.json?.id || resa.json?.reservation?.id;
      const sim = await req('POST', '/api/webhook/paytech/simulate', {
        body: {
          reservation_id: rid,
          ref_command: resa.json?.reference_paytech || resa.json?.ref_command,
          action: 'success',
        },
      });
      fail('F4 simulate pay', sim.status === 200 || sim.status === 201, `status=${sim.status} ${sim.raw}`);
      if (rid) {
        const detail = await req('GET', `/api/reservations/${rid}`, { token: joueurToken });
        const st = detail.json?.statut || detail.json?.reservation?.statut;
        const code = detail.json?.code_reservation || detail.json?.reservation?.code_reservation;
        const qr = detail.json?.qr_code_url || detail.json?.qr_code_payload;
        fail('F4 statut confirme', ['confirme', 'acceptee', 'paye'].includes(String(st)), `statut=${st}`);
        fail('F4 code TF-', /^TF-/i.test(String(code || '')), `code=${code}`);
        fail('F4 qr', Boolean(qr), `qr=${Boolean(qr)}`);
      }
    }
  }

  // FLUX 5 — gerant today
  if (gToken) {
    const today = await req('GET', '/api/gerant/reservations/today', { token: gToken });
    fail('F5 today', today.status === 200, `status=${today.status} ${today.raw}`);
    const keys = today.json ? Object.keys(today.json) : [];
    fail(
      'F5 structure',
      keys.some((k) => ['imminents', 'en_cours', 'libres', 'a_venir', 'en_attente', 'reservations', 'post_match'].includes(k)),
      keys.join(','),
    );
  } else {
    fail('F5 today', false, 'pas de token gérant');
  }

  // FLUX 7 — integrations
  if (saToken) {
    const integ = await req('GET', '/api/admin/integrations', { token: saToken });
    fail('F7 get integrations', integ.status === 200, `status=${integ.status}`);
    const groups = integ.json?.groups || {};
    fail('F7 groups paiement', Boolean(groups.paiement));
    fail('F7 groups whatsapp', Boolean(groups.whatsapp));
    fail('F7 groups general', Boolean(groups.general));
    fail('F7 groups paydunya', Boolean(groups.paydunya) || (integ.json?.fields || []).some((f) => f.group === 'paydunya'));
    const put = await req('PUT', '/api/admin/integrations', {
      token: saToken,
      body: { APP_DOMAIN: process.env.APP_DOMAIN || 'http://localhost:8080' },
    });
    fail('F7 put integrations', put.status === 200, `status=${put.status} ${put.raw}`);
  } else {
    fail('F7 integrations', false, 'pas de token SA');
  }

  // FLUX 8 — push
  const vapid = await req('GET', '/api/push/vapid-public-key');
  fail('F8 vapid', vapid.status === 200 && Boolean(vapid.json?.publicKey || vapid.json?.public_key || vapid.raw), vapid.raw);
  if (joueurToken) {
    const prefs = await req('PUT', '/api/push/preferences', {
      token: joueurToken,
      body: { push_resa_confirmee: 1 },
    });
    fail('F8 put preferences', prefs.status === 200 || prefs.status === 204, `status=${prefs.status}`);
  }

  console.log(`\n=== RESULT: ${fails} FAIL ===`);
  process.exit(fails ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
