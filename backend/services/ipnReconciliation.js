const { queryAll, queryOne, runSql } = require('../database');

const SEUIL_DEFAUT_MS = 3 * 60 * 1000;
const MAX_ATTEMPTS = 3;

function enregistrerTentative(db, { reservationId, refCommand, status, lastError = null }) {
  const existing = queryOne(
    db,
    'SELECT * FROM ipn_reconciliation WHERE reservation_id = ? AND ref_command = ?',
    [reservationId, refCommand],
  );
  if (!existing) {
    runSql(
      db,
      `INSERT INTO ipn_reconciliation (reservation_id, ref_command, attempts, status, last_error)
       VALUES (?, ?, 1, ?, ?)`,
      [reservationId, refCommand, status, lastError],
    );
  } else {
    runSql(
      db,
      `UPDATE ipn_reconciliation
         SET attempts = attempts + 1, status = ?, last_error = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [status, lastError, existing.id],
    );
  }
  return queryOne(
    db,
    'SELECT * FROM ipn_reconciliation WHERE reservation_id = ? AND ref_command = ?',
    [reservationId, refCommand],
  );
}

/**
 * Réservations encore en attente de paiement dont le paiement pending est trop vieux.
 * gateway.statutPaiement(ref) → 'paid' | 'failed' | 'pending'
 */
async function executerReconciliation(db, {
  gateway,
  confirmer,
  alerter,
  now = Date.now(),
  seuilMs = Number(process.env.IPN_RECONCILE_AFTER_MS) || SEUIL_DEFAUT_MS,
  maxAttempts = MAX_ATTEMPTS,
} = {}) {
  const pending = queryAll(
    db,
    `SELECT r.id AS reservation_id, r.statut, p.reference_paytech AS ref_command, p.created_at
     FROM reservations r
     JOIN paiements p ON p.reservation_id = r.id AND p.statut = 'en_attente'
     WHERE r.statut IN ('en_attente', 'en_attente_paiement')
       AND p.reference_paytech IS NOT NULL`,
  );

  const results = [];
  for (const row of pending) {
    const created = row.created_at ? new Date(row.created_at).getTime() : 0;
    if (Number.isFinite(created) && created > 0 && now - created < seuilMs) continue;

    const jobAvant = queryOne(
      db,
      'SELECT attempts FROM ipn_reconciliation WHERE reservation_id = ? AND ref_command = ?',
      [row.reservation_id, row.ref_command],
    );
    if (jobAvant && Number(jobAvant.attempts) >= maxAttempts) continue;

    let remote = 'pending';
    try {
      remote = await gateway.statutPaiement(row.ref_command);
    } catch (error) {
      remote = 'pending';
      const job = enregistrerTentative(db, {
        reservationId: row.reservation_id,
        refCommand: row.ref_command,
        status: 'pending',
        lastError: error.message,
      });
      if (Number(job.attempts) >= maxAttempts) {
        await alerter('ipn_muet', { reservation_id: row.reservation_id, ref: row.ref_command });
      }
      results.push({ reservation_id: row.reservation_id, remote: 'pending', attempts: job.attempts });
      continue;
    }

    if (remote === 'paid') {
      const job = enregistrerTentative(db, {
        reservationId: row.reservation_id,
        refCommand: row.ref_command,
        status: 'paid',
      });
      await confirmer(row.reservation_id, row.ref_command);
      results.push({ reservation_id: row.reservation_id, remote: 'paid', attempts: job.attempts });
    } else if (remote === 'failed') {
      const job = enregistrerTentative(db, {
        reservationId: row.reservation_id,
        refCommand: row.ref_command,
        status: 'failed',
      });
      await alerter('ipn_echec', { reservation_id: row.reservation_id, ref: row.ref_command });
      results.push({ reservation_id: row.reservation_id, remote: 'failed', attempts: job.attempts });
    } else {
      const job = enregistrerTentative(db, {
        reservationId: row.reservation_id,
        refCommand: row.ref_command,
        status: 'pending',
      });
      if (Number(job.attempts) >= maxAttempts) {
        await alerter('ipn_muet', { reservation_id: row.reservation_id, ref: row.ref_command });
      }
      results.push({ reservation_id: row.reservation_id, remote: 'pending', attempts: job.attempts });
    }
  }
  return results;
}

module.exports = { executerReconciliation, enregistrerTentative, SEUIL_DEFAUT_MS, MAX_ATTEMPTS };
