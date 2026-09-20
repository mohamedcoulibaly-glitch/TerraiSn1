/**
 * Confirme les réservations en_attente d'un joueur via IPN PayTech signée (sans Wave/OM).
 * Usage: node scripts/confirm-pending-ipn.js [email]
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const crypto = require('crypto');

const API = process.env.API_URL || 'http://localhost:3001';
const EMAIL = process.argv[2] || 'abdou@email.com';
const PASSWORD = process.env.STAGING_PASSWORD || 'password123';

function sha(v) {
  return crypto.createHash('sha256').update(String(v || '')).digest('hex');
}

function hmac(amount, ref, apiKey, apiSecret) {
  return crypto.createHmac('sha256', apiSecret).update(`${amount}|${ref}|${apiKey}`).digest('hex');
}

async function main() {
  const login = await fetch(`${API}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD, accountType: 'user' }),
  });
  const auth = await login.json();
  if (!login.ok || !auth.token) {
    throw new Error(`Login échoué: ${auth.error || login.status}`);
  }

  const mes = await fetch(`${API}/api/reservations/mes`, {
    headers: { Authorization: `Bearer ${auth.token}` },
  });
  const list = await mes.json();
  const pending = (Array.isArray(list) ? list : []).filter((r) => r.statut === 'en_attente');
  console.log(`Joueur ${EMAIL} — ${pending.length} réservation(s) en_attente`);

  if (!pending.length) {
    console.log('Rien à confirmer.');
    return;
  }

  const apiKey = process.env.PAYTECH_API_KEY;
  const apiSecret = process.env.PAYTECH_API_SECRET;

  for (const r of pending) {
    const amount = Number(r.montant_avance || r.acompte || 0);
    const ref = r.reference_paytech || `TF-${r.id}-${Date.now()}`;
    const payload = {
      type_event: 'sale_complete',
      ref_command: ref,
      item_price: amount,
      final_item_price: amount,
      env: 'test',
      custom_field: JSON.stringify({ reservation_id: r.id }),
      api_key_sha256: sha(apiKey),
      api_secret_sha256: sha(apiSecret),
      hmac_compute: hmac(amount, ref, apiKey, apiSecret),
    };

    const ipn = await fetch(`${API}/webhook/paytech`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const body = await ipn.json().catch(() => ({}));

    const after = await fetch(`${API}/api/reservations/${r.id}`, {
      headers: { Authorization: `Bearer ${auth.token}` },
    });
    const detail = await after.json();
    console.log(
      `#${r.id} ${r.date} ${r.heure_debut} → IPN ${ipn.status} ${JSON.stringify(body)} | statut=${detail.statut} code=${detail.code_reservation || '-'}`,
    );
  }

  console.log('\nOK — recharge Mes réservations (Ctrl+F5).');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
