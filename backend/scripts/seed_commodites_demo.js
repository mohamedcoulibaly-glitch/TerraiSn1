/**
 * Seed démo non destructif : commodités + créneaux du soir (demain+)
 * sur les terrains déjà en base (dont Obélisque).
 *
 * Usage: node scripts/seed_commodites_demo.js
 */
const { getDb, runSql, queryAll, queryOne, saveDb } = require('../database');

function toLocalISO(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const DEMO_SETS = [
  ['dossards', 'eau', 'vestiaires', 'parking'],
  ['dossards', 'ballon', 'eau', 'vestiaires', 'toilettes', 'parking', 'buvette'],
  ['eau', 'vestiaires', 'toilettes', 'tribune', 'parking', 'priere'],
  ['dossards', 'eau', 'vestiaires', 'toilettes', 'buvette', 'glacons', 'secours'],
  ['dossards', 'ballon', 'eau', 'vestiaires', 'parking', 'video'],
];

const OBELISQUE_COMMO = ['dossards', 'eau', 'vestiaires', 'parking', 'toilettes', 'buvette'];

async function main() {
  const db = await getDb();
  const terrains = queryAll(db, 'SELECT id, nom, commodites FROM terrains WHERE COALESCE(is_active, 1) = 1');
  console.log(`🏟️  ${terrains.length} terrain(s) actifs`);

  for (let i = 0; i < terrains.length; i++) {
    const t = terrains[i];
    const isObelisque = /ob[eé]lisque/i.test(String(t.nom || ''));
    const existing = (() => {
      try {
        const p = JSON.parse(t.commodites || '[]');
        return Array.isArray(p) ? p : [];
      } catch {
        return [];
      }
    })();

    const commodites = isObelisque
      ? OBELISQUE_COMMO
      : existing.length > 0
        ? existing
        : DEMO_SETS[i % DEMO_SETS.length];

    runSql(db, 'UPDATE terrains SET commodites = ? WHERE id = ?', [
      JSON.stringify(commodites),
      t.id,
    ]);
    console.log(`  ✓ #${t.id} ${t.nom} → [${commodites.join(', ')}]`);

    // Garantir horaires ouverts
    const jours = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];
    for (const jour of jours) {
      const h = queryOne(db, 'SELECT id FROM horaires WHERE terrain_id = ? AND jour = ?', [t.id, jour]);
      if (!h) {
        runSql(
          db,
          'INSERT INTO horaires (terrain_id, jour, heure_debut, heure_fin, est_ouvert) VALUES (?, ?, ?, ?, 1)',
          [t.id, jour, '08:00', '23:00']
        );
      } else {
        runSql(
          db,
          "UPDATE horaires SET heure_debut = COALESCE(heure_debut,'08:00'), heure_fin = '23:00', est_ouvert = 1 WHERE terrain_id = ? AND jour = ?",
          [t.id, jour]
        );
      }
    }

    // Créneaux soir libres pour demain + 2 jours
    for (let dayOffset = 1; dayOffset <= 3; dayOffset++) {
      const d = new Date();
      d.setHours(12, 0, 0, 0);
      d.setDate(d.getDate() + dayOffset);
      const dateStr = toLocalISO(d);
      for (const hour of [18, 19, 20, 21]) {
        const debut = `${String(hour).padStart(2, '0')}:00`;
        const fin = `${String(hour + 1).padStart(2, '0')}:00`;
        const exists = queryOne(
          db,
          'SELECT id FROM creneaux WHERE terrain_id = ? AND date = ? AND heure_debut = ?',
          [t.id, dateStr, debut]
        );
        if (!exists) {
          runSql(
            db,
            "INSERT INTO creneaux (terrain_id, date, heure_debut, heure_fin, statut) VALUES (?, ?, ?, ?, 'libre')",
            [t.id, dateStr, debut, fin]
          );
        } else {
          runSql(db, "UPDATE creneaux SET statut = 'libre' WHERE id = ?", [exists.id]);
        }
      }
    }
  }

  // Avis démo Obélisque si aucun
  const obe = terrains.find((t) => /ob[eé]lisque/i.test(String(t.nom || '')));
  if (obe) {
    const count = queryOne(db, 'SELECT COUNT(*) AS n FROM avis WHERE terrain_id = ?', [obe.id]);
    if (!count || Number(count.n) === 0) {
      const joueur = queryOne(db, "SELECT id, nom FROM users WHERE role = 'joueur' LIMIT 1");
      if (joueur) {
        const samples = [
          [5, 'Super terrain Obélisque, dossards et eau inclus !'],
          [4, 'Bien situé, vestiaires propres.'],
          [5, 'Parking sécurisé, on reviendra.'],
        ];
        for (const [note, commentaire] of samples) {
          runSql(
            db,
            'INSERT INTO avis (reservation_id, joueur_id, joueur_nom, terrain_id, note, commentaire) VALUES (NULL, ?, ?, ?, ?, ?)',
            [joueur.id, joueur.nom, obe.id, note, commentaire]
          );
        }
        console.log(`  ★ Avis démo ajoutés pour ${obe.nom}`);
      }
    }
  }

  saveDb();
  console.log('✅ Seed commodités + créneaux démo terminé.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
