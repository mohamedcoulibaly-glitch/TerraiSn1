/**
 * Validateurs purs des payloads WhatsApp TerrainSN (templates métier XOF / SN).
 * Pas d'I/O — utilisable en tests unitaires d'efficacité technique.
 */

const CONFIRMATION_MARKERS = [
  "C'est confirmé",
  'Avance payée',
  'À régler sur place',
  'FCFA',
  'Code :',
];

const REMBOURSEMENT_MARKERS = ['remboursé', 'FCFA'];
const PAYOUT_MARKERS = ['FCFA', 'Wave', 'Orange Money', 'reçu', 'virement', 'revers'];

function contientMarqueurs(texte, marqueurs, min = Math.ceil(marqueurs.length * 0.5)) {
  const body = String(texte || '');
  const hits = marqueurs.filter((m) => body.toLowerCase().includes(String(m).toLowerCase()));
  return hits.length >= min;
}

/**
 * Valide un chatId OpenWA sénégalais : 2217XXXXXXXX@c.us
 */
function validerChatIdWhatsApp(chatId) {
  return /^2217\d{8}@c\.us$/.test(String(chatId || ''));
}

/**
 * Structure attendue d'un envoi texte OpenWA.
 */
function validerPayloadMessageTexte(payload = {}) {
  const errors = [];
  if (!payload.chatId && !payload.to) errors.push('chatId_manquant');
  const chatId = payload.chatId || payload.to;
  if (chatId && !validerChatIdWhatsApp(chatId)) errors.push('chatId_invalide');
  if (!payload.message && !payload.body && !payload.text) errors.push('message_manquant');
  const message = payload.message || payload.body || payload.text || '';
  if (message && message.length < 10) errors.push('message_trop_court');
  return { ok: errors.length === 0, errors, chatId, message };
}

/**
 * Template confirmation payin (joueur).
 */
function validerTemplateConfirmation(message, { prenom, code, montantAvance } = {}) {
  const errors = [];
  const body = String(message || '');
  if (!contientMarqueurs(body, CONFIRMATION_MARKERS, 3)) errors.push('marqueurs_confirmation');
  if (prenom && !body.includes(String(prenom))) errors.push('prenom_absent');
  if (code && !body.includes(String(code))) errors.push('code_absent');
  if (montantAvance != null) {
    const montant = Number(montantAvance).toLocaleString('fr-SN');
    if (!body.includes('FCFA') || (!body.includes(String(montantAvance)) && !body.includes(montant))) {
      errors.push('montant_avance_absent');
    }
  }
  return { ok: errors.length === 0, errors };
}

/**
 * Template réception fonds / payout gérant (souple : plusieurs formulations métier).
 */
function validerTemplatePayoutRecu(message, { montant } = {}) {
  const errors = [];
  const body = String(message || '');
  if (!body.includes('FCFA')) errors.push('devise_absente');
  if (montant != null) {
    const raw = String(montant);
    const formatted = Number(montant).toLocaleString('fr-SN');
    if (!body.includes(raw) && !body.includes(formatted)) errors.push('montant_absent');
  }
  const hasContext =
    /reçu|revers|virement|Wave|Orange|payout|dû|versé|portefeuille/i.test(body);
  if (!hasContext) errors.push('contexte_payout_absent');
  return { ok: errors.length === 0, errors };
}

/**
 * Template remboursement / annulation joueur.
 */
function validerTemplateRemboursement(message) {
  const body = String(message || '');
  const ok =
    /rembours/i.test(body) ||
    /annul/i.test(body) ||
    contientMarqueurs(body, REMBOURSEMENT_MARKERS, 1);
  return { ok, errors: ok ? [] : ['template_remboursement_invalide'] };
}

/**
 * Boutons / actions interactives (si présents dans un futur template OpenWA).
 * Accepte l'absence de boutons (messages texte actuels).
 */
function validerBoutonsOptionnels(payload = {}) {
  const buttons = payload.buttons || payload.actions || [];
  if (!Array.isArray(buttons) || buttons.length === 0) {
    return { ok: true, errors: [], mode: 'texte_simple' };
  }
  const errors = [];
  for (const [i, btn] of buttons.entries()) {
    if (!btn.id && !btn.payload) errors.push(`bouton_${i}_id_manquant`);
    if (!btn.text && !btn.title) errors.push(`bouton_${i}_label_manquant`);
  }
  return { ok: errors.length === 0, errors, mode: 'interactif' };
}

module.exports = {
  CONFIRMATION_MARKERS,
  PAYOUT_MARKERS,
  validerChatIdWhatsApp,
  validerPayloadMessageTexte,
  validerTemplateConfirmation,
  validerTemplatePayoutRecu,
  validerTemplateRemboursement,
  validerBoutonsOptionnels,
};
