/**
 * Tests unitaires — pricingService (devis, avance, commission, tarifs).
 * Usage: node scripts/test-pricing.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpDb = path.join(os.tmpdir(), `terrainsn-pricing-${process.pid}-${Date.now()}.db`);
process.env.DB_PATH = tmpDb;

const { createHarness } = require('../test/helpers/harness');
const { getDb, runSql, queryOne } = require('../database');
const {
  prixBaseTerrain,
  calculerMontantAvance,
  calculerCommissionPrelevee,
  calculerDevis,
  calculerPrixReservation,
  prixHoraireEffectif,
  grilleTarifs,
  sauvegarderGrille,
} = require('../pricingService');

const h = createHarness('unit-pricing');

async function main() {
  // --- Pure: prix de base ---
  h.assertEqual(
    'prix entier depuis prix_entier',
    prixBaseTerrain({ prix_entier: 40000, prix_heure: 35000 }, 'entier'),
    40000,
  );
  h.assertEqual(
    'prix entier fallback prix_heure',
    prixBaseTerrain({ prix_heure: 35000 }, 'entier'),
    35000,
  );
  h.assertEqual(
    'prix moitié explicite',
    prixBaseTerrain({ prix_entier: 40000, prix_moitie: 22000 }, 'moitie'),
    22000,
  );
  h.assertEqual(
    'prix moitié défaut 60%',
    prixBaseTerrain({ prix_entier: 40000 }, 'moitie'),
    24000,
  );

  // --- Pure: avance ---
  h.assertEqual(
    'avance 12.5% de 40000',
    calculerMontantAvance({ pourcentage_avance: 12.5 }, 40000),
    5000,
  );
  h.assertEqual(
    'avance plafonnée au montant total',
    calculerMontantAvance({ pourcentage_avance: 100 }, 8000),
    8000,
  );
  h.assertEqual(
    'avance fixe via acompte si % absent',
    calculerMontantAvance({ acompte: 7000 }, 40000),
    7000,
  );
  h.assertEqual(
    'avance défaut 5000 si rien',
    calculerMontantAvance({}, 40000),
    5000,
  );
  h.assertEqual(
    'avance ne dépasse jamais le prix',
    calculerMontantAvance({ acompte: 60000 }, 40000),
    40000,
  );

  // --- Pure: commission ---
  h.assertEqual(
    'commission 10% sur avance',
    calculerCommissionPrelevee({ modele_revenus: 'commission', commission_pourcentage: 10 }, 5000),
    500,
  );
  h.assertEqual(
    'commission 0 si abo',
    calculerCommissionPrelevee({ modele_revenus: 'abonnement', commission_pourcentage: 10 }, 5000),
    0,
  );
  h.assertEqual(
    'commission fixe legacy',
    calculerCommissionPrelevee({ modele_revenus: 'commission', commission: 800 }, 5000),
    800,
  );

  // --- Avec DB: devis + overrides ---
  const db = await getDb();
  const proprioId = runSql(
    db,
    `INSERT INTO proprietaires (nom, prenom, email, password_hash, telephone, statut)
     VALUES ('T', 'P', 'p@test.sn', 'x', '221771111111', 'actif')`,
  ).lastInsertRowid;
  const terrainId = runSql(
    db,
    `INSERT INTO terrains (
      proprietaire_id, nom, adresse, ville, sport, type,
      prix_heure, prix_entier, prix_moitie, pourcentage_avance, commission_pourcentage, modele_revenus, is_active
    ) VALUES (?, 'Arena Test', 'Dakar', 'Dakar', 'foot', '5v5',
      40000, 40000, 24000, 12.5, 10, 'commission', 1)`,
    [proprioId],
  ).lastInsertRowid;
  runSql(
    db,
    `INSERT INTO horaires (terrain_id, jour, heure_debut, heure_fin, est_ouvert)
     VALUES (?, 'lundi', '08:00', '00:00', 1)`,
    [terrainId],
  );
  // Override soirée lundi 18h
  runSql(
    db,
    `INSERT INTO tarifs_dynamiques (terrain_id, jour, heure, prix_entier, prix_moitie)
     VALUES (?, 'lundi', 18, 50000, 30000)`,
    [terrainId],
  );

  const terrain = queryOne(db, 'SELECT * FROM terrains WHERE id = ?', [terrainId]);

  // 2026-09-14 = lundi
  h.assertEqual(
    'override soirée 18h lundi',
    prixHoraireEffectif(db, terrain, '2026-09-14', '18:00', 'entier'),
    50000,
  );
  h.assertEqual(
    'tarif base hors override (10h)',
    prixHoraireEffectif(db, terrain, '2026-09-14', '10:00', 'entier'),
    40000,
  );

  const devis = calculerDevis(db, terrain, {
    date: '2026-09-14',
    heure_debut: '18:00',
    heure_fin: '20:00',
    format_terrain: 'entier',
  });
  h.assertEqual('devis 2h = 50k + 40k', devis.montant, 90000);
  h.assertEqual('devis avance 12.5%', devis.montant_avance, 11250);
  h.assertEqual('devis restant', devis.montant_restant, 78750);
  h.assertEqual('devis detail length', devis.detail.length, 2);

  const devisMoitie = calculerDevis(db, terrain, {
    date: '2026-09-14',
    heure_debut: '18:00',
    heure_fin: '19:00',
    format_terrain: 'moitie',
  });
  h.assertEqual('devis moitié override', devisMoitie.montant, 30000);

  h.assertThrows(
    'devis créneau invalide (même heure)',
    () =>
      calculerDevis(db, terrain, {
        date: '2026-09-14',
        heure_debut: '18:00',
        heure_fin: '18:00',
      }),
    'Créneau invalide',
  );

  h.assertEqual(
    'calculerPrixReservation 1h base',
    calculerPrixReservation(db, terrain, '2026-09-14', '10:00', '11:00', 'entier'),
    40000,
  );

  const grille = grilleTarifs(db, terrain);
  h.assert('grille contient cellules', grille.cellules.length > 0);
  h.assertEqual('grille % avance', grille.pourcentage_avance, 12.5);
  const cell18 = grille.cellules.find((c) => c.jour === 'lundi' && c.heure === 18);
  h.assert('cellule 18h personnalisée', cell18 && cell18.est_personnalise === true);
  h.assertEqual('cellule 18h prix', cell18.prix_entier, 50000);

  const grilleMaj = sauvegarderGrille(db, terrainId, {
    prix_entier_base: 42000,
    prix_moitie_base: 25200,
    cellules: [
      { jour: 'samedi', heure: 20, prix_entier: 60000, prix_moitie: 36000 },
      { jour: 'samedi', heure: 10, prix_entier: 42000, prix_moitie: 25200 }, // = base → non persisté
    ],
  });
  h.assertEqual('base entier maj', grilleMaj.prix_entier_base, 42000);
  const sam20 = queryOne(
    db,
    `SELECT * FROM tarifs_dynamiques WHERE terrain_id = ? AND jour = 'samedi' AND heure = 20`,
    [terrainId],
  );
  h.assert('override samedi 20h persisté', Boolean(sam20) && Number(sam20.prix_entier) === 60000);
  const sam10 = queryOne(
    db,
    `SELECT * FROM tarifs_dynamiques WHERE terrain_id = ? AND jour = 'samedi' AND heure = 10`,
    [terrainId],
  );
  h.assert('override = base non persisté', !sam10);

  h.assertThrows(
    'sauvegarderGrille terrain inexistant',
    () => sauvegarderGrille(db, 999999, { prix_entier_base: 1000, prix_moitie_base: 600 }),
    'Terrain non trouvé',
  );

  try {
    fs.unlinkSync(tmpDb);
  } catch {
    /* ignore */
  }
  h.exitIfFailed();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
