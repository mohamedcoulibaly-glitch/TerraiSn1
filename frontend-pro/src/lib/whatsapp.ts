/**
 * Lien wa.me prérempli (CDC §4.4).
 * Emojis via escapes Unicode pour éviter les "?" selon l’encodage.
 */
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
  let numero = String(opts.whatsappNumber || "").replace(/\D/g, "");
  if (numero.startsWith("00")) numero = numero.slice(2);
  if (numero.startsWith("0") && numero.length === 10) numero = numero.slice(1);
  if (numero.length === 9) numero = `221${numero}`;
  if (!numero || numero.length < 11) return null;

  const joueur = opts.joueurNom?.trim()
    ? `\n${E.user} Joueur : ${opts.joueurNom.trim()}`
    : "";

  const message = encodeURIComponent(
    `${E.soccer} Bonjour !\n` +
      `Je souhaite reserver le terrain *${opts.terrainNom}*\n` +
      `${E.calendar} Date : ${opts.dateLabel}\n` +
      `${E.clock} Creneau : ${opts.heureDebut} - ${opts.heureFin}\n` +
      `${E.money} Montant : ${opts.montant.toLocaleString("fr-FR")} FCFA` +
      `${joueur}\n\n` +
      `Merci de confirmer ${E.check}`
  );

  return `https://wa.me/${numero}?text=${message}`;
}
