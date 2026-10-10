const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { queryOne, runSql, queryAll } = require('../database');

/**
 * Anonymise un compte joueur sans casser l'historique financier des terrains.
 * - PII effacée / remplacée
 * - is_active = 0
 * - réservations futures en_attente annulées (créneau libéré)
 * - historique confirmé / joué conservé (noms anonymisés déjà via users)
 */

function buildAnonymizedIdentity(userId) {
  const token = crypto.randomBytes(6).toString('hex');
  return {
    nom: 'Compte supprimé',
    prenom: null,
    // email UNIQUE NOT NULL — valeur technique non réutilisable
    email: `deleted_${userId}_${token}@anonymized.local`,
    telephone: `deleted_${userId}_${token}`,
    password_hash: bcrypt.hashSync(crypto.randomBytes(24).toString('hex'), 8),
  };
}

function anonymiserCompteJoueur(db, userId, { reason = 'user_request' } = {}) {
  const id = Number(userId);
  if (!Number.isFinite(id) || id <= 0) {
    const err = new Error('Utilisateur invalide');
    err.statusCode = 400;
    throw err;
  }

  const user = queryOne(db, 'SELECT * FROM users WHERE id = ?', [id]);
  if (!user) {
    const err = new Error('Compte introuvable');
    err.statusCode = 404;
    throw err;
  }
  if (String(user.role || 'joueur') !== 'joueur') {
    const err = new Error('Seuls les comptes joueur peuvent être anonymisés via cette API');
    err.statusCode = 403;
    throw err;
  }
  if (Number(user.is_active) === 0 && String(user.telephone || '').startsWith('deleted_')) {
    return { already: true, user_id: id };
  }

  const identity = buildAnonymizedIdentity(id);

  runSql(
    db,
    `UPDATE users SET
      nom = ?, prenom = ?, email = ?, telephone = ?, password_hash = ?,
      is_active = 0, telephone_verified = 0,
      refresh_token = NULL, refresh_token_expire_at = NULL
     WHERE id = ?`,
    [
      identity.nom,
      identity.prenom,
      identity.email,
      identity.telephone,
      identity.password_hash,
      id,
    ],
  );

  // Annule les réservations futures encore en attente (pas d'impact caisse)
  const pending = queryAll(
    db,
    `SELECT id FROM reservations
      WHERE joueur_id = ?
        AND statut = 'en_attente'
        AND date >= date('now')`,
    [id],
  );
  for (const row of pending) {
    runSql(db, `UPDATE reservations SET statut = 'annule' WHERE id = ?`, [row.id]);
  }

  // Anonymise le nom affiché sur réservations non jouées futures (historique joué garde cohérence comptable)
  runSql(
    db,
    `UPDATE reservations SET
      joueur_nom = 'Compte supprimé',
      joueur_telephone = NULL
     WHERE joueur_id = ?
       AND statut IN ('en_attente', 'confirme', 'acceptee')
       AND date >= date('now')`,
    [id],
  );

  try {
    runSql(
      db,
      `INSERT INTO notifications (destinataire_type, destinataire_id, type, canal, contenu, lu)
       VALUES ('user', ?, 'compte_anonymise', 'systeme', ?, 1)`,
      [id, `Compte anonymisé (${reason})`],
    );
  } catch {
    /* table / colonnes best-effort */
  }

  return {
    already: false,
    user_id: id,
    pending_cancelled: pending.length,
    telephone_anonymized: true,
    reason,
  };
}

module.exports = {
  buildAnonymizedIdentity,
  anonymiserCompteJoueur,
};
