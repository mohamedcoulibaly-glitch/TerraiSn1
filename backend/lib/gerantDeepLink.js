/**
 * URL poussée au gérant quand une réservation est confirmée.
 * GERANT_MONO_HOST=1 → préfixe /pro (hôte unique).
 */
function gerantDeepLink(env = process.env) {
  if (String(env.GERANT_MONO_HOST || '').trim() === '1') return '/pro';
  return '/backoffice/gerant';
}

module.exports = { gerantDeepLink };
