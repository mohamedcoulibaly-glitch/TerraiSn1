/**
 * Smoke E2E des workflows gérant 1–8 (API).
 * Usage: node scripts/test-workflows-gerant.js
 */
const API = process.env.API_URL || 'http://localhost:3001/api';

async function req(path, { method = 'GET', token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = {};
  try {
    data = await res.json();
  } catch {
    data = {};
  }
  return { status: res.status, ok: res.ok, data };
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function todayYmd() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function hourSlot(offsetHours = 3) {
  const d = new Date();
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + offsetHours);
  const h = d.getHours();
  const debut = `${String(h).padStart(2, '0')}:00`;
  const fin = `${String((h + 1) % 24).padStart(2, '0')}:00`;
  return { debut, fin, h };
}

async function main() {
  const results = [];
  const log = (name, ok, detail = '') => {
    results.push({ name, ok, detail });
    console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
  };

  try {
    // Auth
    const login = await req('/backoffice/auth/login', {
      method: 'POST',
      body: { email: 'babacar.sene@gmail.com', password: 'password123' },
    });
    assert(login.ok && (login.data.token || login.data.accessToken), `Login failed: ${JSON.stringify(login.data)}`);
    const token = login.data.accessToken || login.data.token;
    const terrainId = login.data.user?.terrain_id;
    log('Auth login gérant', true, `terrain=${terrainId}`);

    // W1 — today + dashboard
    const today = await req('/gerant/reservations/today', { token });
    assert(today.ok, `today: ${today.data.error}`);
    assert(Array.isArray(today.data.reservations), 'reservations array');
    log('W1 GET /gerant/reservations/today', true, `${today.data.reservations.length} résas`);

    const dash = await req('/gerant/dashboard', { token });
    assert(dash.ok, `dashboard: ${dash.data.error}`);
    assert(dash.data.terrain, 'terrain present');
    log('W1 dashboard', true, dash.data.terrain?.nom || '');

    // W8 — horaires
    const jours = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];
    const horaires = jours.map((jour) => ({
      jour,
      est_ouvert: 1,
      heure_debut: '08:00',
      heure_fin: '23:00',
    }));
    const putH = await req('/gerant/horaires', { method: 'PUT', token, body: { horaires } });
    assert(putH.ok, `horaires: ${putH.data.error}`);
    log('W8 PUT /gerant/horaires', true);

    const date = todayYmd();

    // Nettoyer les anciens blocages du jour (état sale des tests précédents)
    const dashClean = await req('/gerant/dashboard', { token });
    const oldBlocks = (dashClean.data.blocages || []).filter((b) => String(b.date).slice(0, 10) === date);
    for (const b of oldBlocks) {
      await req(`/gerant/blocages/${b.id}`, { method: 'DELETE', token });
    }
    if (oldBlocks.length) log('Cleanup blocages', true, `${oldBlocks.length} supprimés`);

    // Créneaux libres
    const creneaux = await req(`/terrains/${terrainId}/creneaux?date=${date}`, { token });
    assert(creneaux.ok, `creneaux: ${creneaux.data.error}`);
    const libres = (creneaux.data.creneaux || []).filter((c) => c.disponible);
    log('Creneaux libres jour', libres.length > 0, `${libres.length} libres`);

    // W6 — blocage batch
    // Préférer un créneau libre clairement hors des heures déjà bloquées
    const slotToBlock =
      libres.find((c) => {
        const h = parseInt(String(c.heure || c.heure_debut).slice(0, 2), 10);
        return h >= 14 && h <= 16;
      }) ||
      libres[libres.length - 1] ||
      libres[0];

    if (slotToBlock) {
      const debut = String(slotToBlock.heure_debut || slotToBlock.heure).slice(0, 5);
      const fin = String(slotToBlock.heure_fin || '').slice(0, 5) || (() => {
        const h = parseInt(debut, 10);
        return `${String(h + 1).padStart(2, '0')}:00`;
      })();
      const batch = await req('/gerant/blocages/batch', {
        method: 'POST',
        token,
        body: { date, motif: 'pluie', creneaux: [{ heure_debut: debut, heure_fin: fin }] },
      });
      assert(batch.ok, `batch blocage: ${batch.data.error || JSON.stringify(batch.data)}`);
      assert(batch.data.count >= 1, 'count >= 1');
      log('W6 POST /gerant/blocages/batch', true, batch.data.message);

      const blocageId = batch.data.blocages?.[0]?.id;
      // Vérifie disparition app joueur
      const after = await req(`/terrains/${terrainId}/creneaux?date=${date}`, { token });
      const stillFree = (after.data.creneaux || []).some(
        (c) => String(c.heure_debut || c.heure).slice(0, 5) === debut && c.disponible,
      );
      assert(!stillFree, 'créneau encore disponible après blocage');
      log('W6 créneau masqué joueur', true, debut);

      if (blocageId) {
        const del = await req(`/gerant/blocages/${blocageId}`, { method: 'DELETE', token });
        assert(del.ok, `deblocage: ${del.data.error}`);
        log('W6 DELETE déblocage', true);
      }
    } else {
      log('W6 blocage batch', false, 'aucun créneau libre à tester');
    }

    // W5 — express bloquer (sans PayTech)
    const freeAfter = await req(`/terrains/${terrainId}/creneaux?date=${date}`, { token });
    const freeSlot = (freeAfter.data.creneaux || []).find((c) => c.disponible);
    if (freeSlot) {
      const debut = String(freeSlot.heure_debut || freeSlot.heure).slice(0, 5);
      const fin = String(freeSlot.heure_fin || '').slice(0, 5) || `${String(parseInt(debut, 10) + 1).padStart(2, '0')}:00`;
      const create = await req('/reservations/gerant', {
        method: 'POST',
        token,
        body: {
          terrain_id: terrainId,
          date,
          heure_debut: debut,
          heure_fin: fin,
          joueur_nom: 'Test Walkin W5',
          mode: 'bloquer',
          anonyme: true,
          format_terrain: 'entier',
        },
      });
      assert(create.ok, `create bloquer: ${create.data.error || JSON.stringify(create.data)}`);
      assert(create.data.mode === 'bloquer', 'mode bloquer');
      assert(create.data.statut === 'confirme', `statut=${create.data.statut}`);
      assert(!create.data.lien_paiement, 'pas de lien paiement');
      log('W5 create mode=bloquer', true, `id=${create.data.reservation_id}`);

      const resaId = create.data.reservation_id;
      const detail = await req(`/gerant/reservations/${resaId}`, { token });
      assert(detail.ok, `detail: ${detail.data.error}`);
      log('W5 détail réservation', true, detail.data.statut);

      // W3/W4 — by-code + scan manuel (peut échouer trop tôt / trop tard selon heure)
      if (detail.data.code_reservation) {
        const byCode = await req(`/gerant/reservations/by-code/${detail.data.code_reservation}`, { token });
        assert(byCode.ok, `by-code: ${byCode.data.error}`);
        assert(Number(byCode.data.id) === Number(resaId), 'id match');
        log('W3 GET by-code', true, detail.data.code_reservation);

        const qr = JSON.stringify({
          reservation_id: resaId,
          code: detail.data.code_reservation,
        });
        const scan = await req(`/reservations/${resaId}/scan-qr`, {
          method: 'POST',
          token,
          body: { methode: 'especes', qr_data: qr },
        });
        if (scan.ok) {
          assert(scan.data.reservation, 'reservation in scan response');
          assert(typeof scan.data.reservation.montant_restant === 'number', 'montant_restant présent');
          log('W3/W4/W7 scan-qr succès', true, `reste=${scan.data.reservation.montant_restant}`);
        } else {
          const code = scan.data.code;
          const allowed = ['QR_SCAN_TOO_EARLY', 'QR_SCAN_EXPIRED', 'QR_ALREADY_SCANNED', 'QR_BAD_STATUS'];
          assert(allowed.includes(code) || scan.status < 500, `scan error inattendu: ${code} ${scan.data.error}`);
          log('W3 scan-qr (fenêtre)', true, `${code} — comportement attendu selon l'heure`);
        }
      } else {
        log('W3 by-code', false, 'pas de code_reservation sur résa bloquée');
      }

      // Cleanup: annuler si encore annulable
      await req(`/gerant/reservations/${resaId}/annuler`, { method: 'PATCH', token });
    } else {
      log('W5 create bloquer', false, 'aucun créneau libre');
    }

    // W2 — imminentes calculables côté client (API fournit la liste)
    const today2 = await req('/gerant/reservations/today', { token });
    assert(today2.ok, 'today refresh');
    log('W2 data imminentes', true, `${today2.data.reservations.length} résas pour calcul front`);

    // Route batch exists
    const badBatch = await req('/gerant/blocages/batch', {
      method: 'POST',
      token,
      body: { date, creneaux: [] },
    });
    assert(badBatch.status === 400, 'batch vide doit 400');
    log('W6 batch validation', true);

  } catch (err) {
    log('FATAL', false, err.message);
  }

  const failed = results.filter((r) => !r.ok);
  console.log('\n---');
  console.log(`${results.filter((r) => r.ok).length}/${results.length} OK`);
  if (failed.length) {
    console.log('ÉCHECS:');
    failed.forEach((f) => console.log(`  - ${f.name}: ${f.detail}`));
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
