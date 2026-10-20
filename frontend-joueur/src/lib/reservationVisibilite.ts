const STATUTS_INVISIBLES = new Set(["expire"]);

/**
 * La carte existe dès la création (badge « Paiement en cours » tant que
 * l'IPN n'a pas confirmé) — sinon le joueur qui vient de payer ne retrouve
 * pas sa réservation. Le QR/code restent masqués avant confirmation (US-17).
 * Seules les réservations expirées (verrou abandonné) sont invisibles.
 */
export function reservationVisibleJoueur(reservation: { statut?: string | null } | null | undefined): boolean {
  return !STATUTS_INVISIBLES.has(String(reservation?.statut || ""));
}

const STATUTS_QR = new Set(["confirme", "acceptee"]);

/** QR et code d'accès seulement quand la réservation est confirmée (US-17). */
export function reservationAfficheQr(statut?: string | null): boolean {
  return STATUTS_QR.has(String(statut || ""));
}
