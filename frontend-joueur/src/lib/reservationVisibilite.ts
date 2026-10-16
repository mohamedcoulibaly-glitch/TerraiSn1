const STATUTS_INVISIBLES = new Set(["expire", "en_attente", "en_attente_paiement"]);

/** Une carte joueur n'existe qu'après paiement confirmé (US-04). */
export function reservationVisibleJoueur(reservation: { statut?: string | null } | null | undefined): boolean {
  return !STATUTS_INVISIBLES.has(String(reservation?.statut || ""));
}

const STATUTS_QR = new Set(["confirme", "acceptee"]);

/** QR et code d'accès seulement quand la réservation est confirmée (US-17). */
export function reservationAfficheQr(statut?: string | null): boolean {
  return STATUTS_QR.has(String(statut || ""));
}
