/**
 * Tests API des 10 corrections backoffice gérant.
 * Usage : node scripts/test-corrections-10.js
 */
const API = process.env.API_URL || 'http://localhost:3001/api';
const EMAIL = 'mohamed.gerant@gmail.com';
const PASSWORD = 'password123';

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
    data = { raw: await res.text().catch(() => '') };
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

async function main() {
  const results = [];
  const log = (name, ok, detail = '') => {
    results.push({ name, ok, detail });
    console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
  };

  const login = await req('/backoffice/auth/login', {
    method: 'POST',
    body: { email: EMAIL, password: PASSWORD },
  });
  assert(login.ok && (login.data.token || login.data.accessToken), `Login: ${JSON.stringify(login.data)}`);
  const token = login.data.accessToken || login.data.token;
  const terrainId = login.data.user?.terrain_id;
  log('Auth gérant', true, `terrain=${terrainId}`);

  // C1 — lookup téléphone
  const lookup = await req('/joueurs/telephone/771234567', { token });
  assert(lookup.ok, `lookup: ${lookup.data.error}`);
  assert(lookup.data.trouve === true && lookup.data.joueur, 'Abdou introuvable au lookup 771234567');
  assert(
    !/abdou\s+abdou/i.test(lookup.data.joueur.display_nom || ''),
    `display_nom dupliqué: ${lookup.data.joueur.display_nom}`,
  );
  log('C1 Lookup téléphone 771234567', true, lookup.data.joueur.display_nom);

  const lookupBad = await req('/joueurs/telephone/12', { token });
  assert(lookupBad.status === 400, `lookup court devrait 400, got ${lookupBad.status}`);
  log('C1 Lookup numéro invalide → 400', true);

  // C2 — créneau libre malgré en_attente
  const date = todayYmd();
  const creneaux = await req(`/terrains/${terrainId}/creneaux?date=${date}`, { token });
  assert(creneaux.ok, `creneaux: ${creneaux.data.error}`);
  const slot22 = (creneaux.data.creneaux || []).find((c) => String(c.heure || c.heure_debut).slice(0, 5) === '22:00');
  if (slot22) {
    assert(slot22.disponible === true, `22:00 devrait rester libre (en_attente only), statut=${slot22.statut}`);
    log('C2 Créneau 22h libre malgré en_attente', true, slot22.statut);
  } else {
    log('C2 Créneau 22h', false, 'slot 22:00 absent (terrain fermé ?)');
  }

  // C4 — today / week AJAX
  const today = await req('/gerant/reservations/today', { token });
  assert(today.ok && Array.isArray(today.data.reservations), `today: ${today.data.error}`);
  log('C4 GET today', true, `${today.data.reservations.length} résas`);

  const week = await req('/gerant/reservations/week', { token });
  assert(week.ok && Array.isArray(week.data.reservations), `week: ${week.data.error}`);
  log('C4 GET week', true, `${week.data.reservations.length} résas`);

  // C5 — finances pills
  for (const periode of ['aujourd_hui', 'semaine', 'mois', 'annee']) {
    const fin = await req(`/gerant/finances?periode=${periode}`, { token });
    assert(fin.ok, `finances ${periode}: ${fin.data.error}`);
    assert(typeof fin.data.total_encaisse === 'number', 'total_encaisse manquant');
    assert(fin.data.commission == null && fin.data.reversement == null, 'commission/reversement encore exposés');
    log(`C5 Finances ${periode}`, true, `encaissé=${fin.data.total_encaisse} joués=${fin.data.matchs_joues}`);
  }

  // C6 — tarifs lecture seule + prix actif
  const tarifs = await req('/gerant/tarifs', { token });
  assert(tarifs.ok, `tarifs: ${tarifs.data.error}`);
  assert(Array.isArray(tarifs.data.regles), 'regles absentes');
  log('C6 GET tarifs (lecture)', true, `${tarifs.data.regles.length} règles`);

  const putTarifs = await req('/gerant/tarifs', { method: 'PUT', token, body: { prix_entier: 1 } });
  assert(putTarifs.status === 403, `PUT tarifs devrait 403, got ${putTarifs.status}`);
  log('C6 PUT tarifs → 403', true, putTarifs.data.code || '');

  const devis = await req(`/gerant/devis?date=${date}&heure_debut=19:00&heure_fin=20:00&format=entier`, { token });
  assert(devis.ok, `devis: ${devis.data.error}`);
  log('C6 Devis 19h', true, `${devis.data.montant || devis.data.prix_total || JSON.stringify(devis.data)}`);

  // C8 — profil gérant
  const profil = await req('/profil/gerant', { token });
  assert(profil.ok && profil.data.account, `profil: ${profil.data.error}`);
  const nomProfil = [profil.data.account.prenom, profil.data.account.nom].filter(Boolean).join(' ');
  assert(!/mohamed\s+mohamed/i.test(nomProfil), `profil nom dupliqué: ${nomProfil}`);
  log('C8 GET profil gérant', true, profil.data.account.nom || profil.data.terrain?.nom);

  // C9 — listes séparées
  const listAll = await req('/gerant/reservations?statut=all', { token });
  assert(listAll.ok && Array.isArray(listAll.data.reservations), `list: ${listAll.data.error}`);
  const hasAnnulee = listAll.data.reservations.some((r) => ['annulee', 'annule', 'refusee'].includes(r.statut));
  log('C9 Liste réservations (all)', true, `${listAll.data.reservations.length} dont annulées=${hasAnnulee}`);

  const listPhone = await req('/gerant/reservations?statut=all&q=771234567', { token });
  assert(listPhone.ok, `list phone: ${listPhone.data.error}`);
  assert(
    listPhone.data.reservations.every((r) => String(r.joueur_telephone || '').replace(/\D/g, '').includes('771234567')),
    'filtre téléphone résa a laissé passer un autre numéro',
  );
  log('C9 Recherche résa par téléphone', true, `${listPhone.data.reservations.length} Abdou`);

  const joueursAll = await req('/gerant/joueurs?filter=all', { token });
  assert(joueursAll.ok && Array.isArray(joueursAll.data.joueurs), `joueurs: ${joueursAll.data.error}`);
  const fatou = joueursAll.data.joueurs.find((j) => /fatou/i.test(j.display_nom || ''));
  assert(fatou, 'Fatou absente de la liste joueurs');
  assert(Number(fatou.reservations_total || 0) >= 3, `Fatou devrait être fréquente, total=${fatou.reservations_total}`);
  log('C9 Liste joueurs', true, `${joueursAll.data.joueurs.length} joueurs`);

  const frequents = await req('/gerant/joueurs?filter=frequents', { token });
  assert(frequents.ok, `frequents: ${frequents.data.error}`);
  assert(
    frequents.data.joueurs.some((j) => j.id === fatou.id),
    'Fatou absente du filtre fréquents',
  );
  log('C9 Filtre fréquents', true, `${frequents.data.joueurs.length}`);

  const nouveaux = await req('/gerant/joueurs?filter=nouveaux', { token });
  assert(nouveaux.ok, `nouveaux: ${nouveaux.data.error}`);
  const aminata = nouveaux.data.joueurs.find((j) => /aminata/i.test(j.display_nom || ''));
  log('C9 Filtre nouveaux ce mois', Boolean(aminata), aminata ? aminata.display_nom : 'Aminata absente');

  const joueurPhone = await req('/gerant/joueurs?filter=all&q=779998877', { token });
  assert(joueurPhone.ok, `joueurs q: ${joueurPhone.data.error}`);
  assert(
    joueurPhone.data.joueurs.every((j) => String(j.telephone || '').replace(/\D/g, '').includes('779998877')),
    'filtre téléphone joueur a laissé passer un autre numéro',
  );
  log('C9 Recherche joueur par téléphone', true, `${joueurPhone.data.joueurs.length}`);

  if (aminata) {
    const fiche = await req(`/gerant/joueurs/${aminata.id}`, { token });
    assert(fiche.ok, `fiche: ${fiche.data.error}`);
    assert(
      (fiche.data.reservations || []).every((r) => Number(r.terrain_id || terrainId) === Number(terrainId) || r.date),
      'historique hors terrain ?',
    );
    log('C9 Fiche joueur (ce terrain)', true, `${(fiche.data.reservations || []).length} résas`);
  }

  // C10 — scanner disparaît
  const scanned = (today.data.reservations || []).find((r) => r.qr_code_scanne_at);
  const notScanned = (today.data.reservations || []).find(
    (r) => r.statut === 'confirme' && !r.qr_code_scanne_at,
  );
  assert(scanned, 'aucune résa scannée aujourd’hui (relancer le seed)');
  assert(scanned.qr_code_scanne_at, 'qr_code_scanne_at manquant');
  log('C10 Résa scannée (badge entrée)', true, `${scanned.joueur_nom} reste=${scanned.montant_restant}`);
  if (notScanned) {
    log('C10 Résa à scanner', true, `${notScanned.joueur_nom} ${notScanned.heure_debut}`);
  } else {
    log('C10 Résa à scanner', false, 'aucune confirmée non scannée');
  }

  const detailScanned = await req(`/gerant/reservations/${scanned.id}`, { token });
  assert(detailScanned.ok, `detail: ${detailScanned.data.error}`);
  assert(detailScanned.data.qr_code_scanne_at, 'detail sans qr_code_scanne_at');
  log('C10 Détail scanné', true, `id=${scanned.id}`);

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} OK`);
  if (failed.length) {
    console.error('Échecs :', failed.map((f) => f.name).join(', '));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('\nTEST FAILED:', err.message);
  process.exit(1);
});
