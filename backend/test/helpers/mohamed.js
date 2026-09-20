/**
 * Compte de test unifié Mohamed — Joueur + Gérant, WhatsApp + XOF.
 * Source de vérité métier pour la suite PayDunya / WhatsApp.
 */
const MOHAMED = Object.freeze({
  nom: 'Mohamed Coulibaly',
  prenom: 'Mohamed',
  telephoneRaw: '+221778261225',
  telephoneLocal9: '778261225',
  telephoneStore: '+221 77 826 12 25',
  telephoneDigitsIntl: '221778261225',
  whatsappChatId: '221778261225@c.us',
  emailJoueur: 'mohamed.joueur@gmail.com',
  emailGerant: 'mohamed.gerant@gmail.com',
  devise: 'XOF',
  deviseLabel: 'FCFA',
  /** Montants réalistes sandbox PayDunya (min 200 XOF) */
  montants: Object.freeze({
    avancePayin: 5000,
    prixTotal: 40000,
    resteSurPlace: 35000,
    payoutGerant: 4455,
    commission: 500,
  }),
});

module.exports = { MOHAMED };
