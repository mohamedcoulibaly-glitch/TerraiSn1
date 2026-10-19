/**
 * Lien WhatsApp prérempli pour une demande de réservation (CDC §4.4).
 * Sur mobile → schéma whatsapp:// (app native), sinon wa.me.
 */
import { whatsAppHref } from "./openWhatsapp";

const E = {
  soccer: "\u26BD",
  calendar: "\uD83D\uDCC5",
  clock: "\u23F0",
  money: "\uD83D\uDCB0",
  check: "\u2705",
  user: "\uD83D\uDC64",
};

export function buildReservationWhatsAppLink(opts: {
  whatsappNumber: string;
  terrainNom: string;
  dateLabel: string;
  heureDebut: string;
  heureFin: string;
  montant: number;
  joueurNom?: string;
}): string | null {
  const joueur = opts.joueurNom?.trim()
    ? `\n${E.user} Joueur : ${opts.joueurNom.trim()}`
    : "";

  const message =
    `${E.soccer} Bonjour !\n` +
    `Je souhaite reserver le terrain *${opts.terrainNom}*\n` +
    `${E.calendar} Date : ${opts.dateLabel}\n` +
    `${E.clock} Creneau : ${opts.heureDebut} - ${opts.heureFin}\n` +
    `${E.money} Montant : ${opts.montant.toLocaleString("fr-FR")} FCFA` +
    `${joueur}\n\n` +
    `Merci de confirmer ${E.check}`;

  return whatsAppHref(opts.whatsappNumber, message);
}
