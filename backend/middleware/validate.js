/**
 * Validation légère des payloads critiques (auth / réservation).
 * Pas de dépendance Zod côté backend — règles explicites et testables.
 */

function badRequest(message, field) {
  const err = new Error(message);
  err.statusCode = 400;
  err.code = 'VALIDATION_ERROR';
  if (field) err.field = field;
  return err;
}

function requireString(body, field, { min = 1, max = 255, label } = {}) {
  const raw = body?.[field];
  const value = raw == null ? '' : String(raw).trim();
  const name = label || field;
  if (value.length < min) throw badRequest(`${name} obligatoire`, field);
  if (value.length > max) throw badRequest(`${name} trop long`, field);
  return value;
}

function requireOptionalString(body, field, { max = 255 } = {}) {
  if (body?.[field] == null || body[field] === '') return null;
  const value = String(body[field]).trim();
  if (value.length > max) throw badRequest(`${field} trop long`, field);
  return value;
}

function validateRegisterBody(body) {
  // Inscription joueur minimal : téléphone + prénom + mot de passe (pas de nom/email requis).
  const prenom = requireString(body, 'prenom', { min: 1, max: 120, label: 'Prénom' });
  const nom = requireOptionalString(body, 'nom', { max: 120 }) || '';
  const telephone = requireString(body, 'telephone', { min: 8, max: 30, label: 'Téléphone' });
  const password = requireString(body, 'password', { min: 6, max: 128, label: 'Mot de passe' });
  const email = requireOptionalString(body, 'email', { max: 180 });
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw badRequest('Email invalide', 'email');
  }
  return { nom, prenom, telephone, password, email };
}

function validateVerifyOtpBody(body) {
  const telephone = requireString(body, 'telephone', { min: 8, max: 30, label: 'Téléphone' });
  const code = requireString(body, 'code', { min: 4, max: 8, label: 'Code' });
  if (!/^\d+$/.test(code)) throw badRequest('Code OTP invalide', 'code');
  return { telephone, code };
}

function validateReservationCreateBody(body) {
  const terrain_id = Number(body?.terrain_id);
  if (!Number.isFinite(terrain_id) || terrain_id <= 0) {
    throw badRequest('terrain_id invalide', 'terrain_id');
  }
  const date = requireString(body, 'date', { min: 8, max: 32, label: 'Date' });
  if (!/^\d{4}-\d{2}-\d{2}/.test(date)) {
    throw badRequest('Date invalide (AAAA-MM-JJ)', 'date');
  }
  const heure_debut = requireString(body, 'heure_debut', { min: 4, max: 8, label: 'Heure début' });
  const heure_fin = requireString(body, 'heure_fin', { min: 4, max: 8, label: 'Heure fin' });
  const joueur_nom = requireString(body, 'joueur_nom', { min: 1, max: 160, label: 'Nom joueur' });
  const joueur_telephone = requireString(body, 'joueur_telephone', { min: 8, max: 30, label: 'Téléphone joueur' });
  const format_terrain = body?.format_terrain === 'moitie' ? 'moitie' : 'entier';
  return {
    terrain_id,
    date: date.slice(0, 10),
    heure_debut,
    heure_fin,
    joueur_nom,
    joueur_telephone,
    format_terrain,
  };
}

/** Middleware Express : applique un validateur et remplace req.body par le résultat. */
function validateBody(validator) {
  return (req, res, next) => {
    try {
      req.body = { ...req.body, ...validator(req.body || {}) };
      return next();
    } catch (err) {
      return res.status(err.statusCode || 400).json({
        error: err.message || 'Données invalides',
        code: err.code || 'VALIDATION_ERROR',
        field: err.field,
      });
    }
  };
}

module.exports = {
  badRequest,
  requireString,
  validateRegisterBody,
  validateVerifyOtpBody,
  validateReservationCreateBody,
  validateBody,
};
