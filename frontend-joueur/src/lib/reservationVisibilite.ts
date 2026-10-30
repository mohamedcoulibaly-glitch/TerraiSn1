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

/** QR in-app uniquement si statut === confirme (pas pendant en_attente). */
export function reservationAfficheQr(statut?: string | null): boolean {
  return String(statut || "") === "confirme";
}
