const { queryOne, runSql } = require('../database');

async function crediterPortefeuilleGerant(db, {
  gerantId,
  terrainId,
  reservationId,
  montantEncaisse,
  montantCommission = 0,
  statutReversement = 'effectue',
}) {
  const gerant = Number(gerantId);
  const terrain = Number(terrainId);
  const encaisse = Math.max(0, Math.round(Number(montantEncaisse || 0)));
  const commission = Math.max(0, Math.round(Number(montantCommission || 0)));
  const reverse = Math.max(0, encaisse - commission);
  if (!gerant || !terrain || encaisse <= 0) return { montant_reverse: 0, solde_disponible: 0 };

  await runSql(
    db,
    `INSERT INTO portefeuille_gerant
        (gerant_id, terrain_id, solde_disponible, total_encaisse, total_commission_prelevee)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(gerant_id, terrain_id) DO UPDATE SET
          solde_disponible = portefeuille_gerant.solde_disponible + EXCLUDED.solde_disponible,
          total_encaisse = portefeuille_gerant.total_encaisse + EXCLUDED.total_encaisse,
          total_commission_prelevee = portefeuille_gerant.total_commission_prelevee + EXCLUDED.total_commission_prelevee,
          updated_at = CURRENT_TIMESTAMP`,
    [gerant, terrain, reverse, encaisse, commission],
  );

  if (reservationId) {
    await runSql(
      db,
      `INSERT INTO reversements (gerant_id, terrain_id, reservation_id, montant, commission_prelevee, statut)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT (reservation_id) DO NOTHING`,
      [gerant, terrain, reservationId, reverse, commission, statutReversement],
    );
  }

  const wallet = await queryOne(
    db,
    'SELECT solde_disponible FROM portefeuille_gerant WHERE gerant_id = ? AND terrain_id = ?',
    [gerant, terrain],
  );
  return {
    montant_reverse: reverse,
    montant_commission: commission,
    solde_disponible: Number(wallet?.solde_disponible || reverse),
  };
}

async function encaisserSoldeSurPlace(db, reservation, gerantId, methode = 'especes') {
  const solde = Number(reservation.reste_a_payer ?? reservation.montant_restant ?? 0);
  if (solde <= 0) return 0;

  await runSql(
    db,
    `UPDATE reservations
       SET reste_a_payer = 0, montant_restant = 0
     WHERE id = ? AND COALESCE(montant_restant, reste_a_payer, 0) > 0`,
    [reservation.id],
  );

  await runSql(
    db,
    `INSERT INTO paiements (reservation_id, montant, methode, statut, reference_externe)
     VALUES (?, ?, ?, 'paye', ?)`,
    [reservation.id, solde, methode, `SOLDE-${reservation.id}-${Date.now()}`],
  );

  await crediterPortefeuilleGerant(db, {
    gerantId,
    terrainId: reservation.terrain_id,
    reservationId: reservation.id,
    montantEncaisse: solde,
    montantCommission: 0,
  });

  return solde;
}

module.exports = {
  crediterPortefeuilleGerant,
  encaisserSoldeSurPlace,
};
