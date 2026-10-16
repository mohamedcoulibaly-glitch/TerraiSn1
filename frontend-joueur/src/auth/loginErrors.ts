/** Messages d'erreur login — mapping UI sur les codes HTTP déjà renvoyés par l'API. */

export function isNetworkError(err: unknown): boolean {
  const msg = String((err as { message?: string })?.message || "");
  const name = String((err as { name?: string })?.name || "");
  return (
    name === "TypeError" ||
    /failed to fetch|networkerror|connexion au serveur|connexion impossible/i.test(msg)
  );
}

export function messageErreurAuth(
  err: unknown,
  contexte: "joueur" | "backoffice" | "otp" | "forgot" = "joueur",
): string {
  const e = err as { status?: number; message?: string; code?: string };
  const msg = String(e?.message || "");

  if (isNetworkError(err)) {
    return "Connexion impossible. Vérifie ta connexion.";
  }

  if (e?.status === 429 || /trop de tentatives/i.test(msg)) {
    return "Trop de tentatives. Réessayez dans quelques minutes.";
  }

  if (e?.code === "COMPTE_PRO" || /compte professionnel|espace pro|terrain ?sn pro/i.test(msg)) {
    return "Ce numéro est un compte professionnel. Ouvre TerrainSN Pro.";
  }

  if (e?.status === 403 || /suspendu/i.test(msg)) {
    return "Compte suspendu. Contacte l'administration.";
  }

  if (contexte === "otp") {
    if (/expir/i.test(msg)) return "Code expiré. Demande-en un nouveau.";
    return "Code incorrect. Vérifie ton WhatsApp.";
  }

  if (contexte === "forgot") {
    if (e?.status === 404 || /aucun compte|introuvable|pas dans notre système/i.test(msg)) {
      return "Ce numéro n'est pas dans notre système.";
    }
    if (/déjà vérifié/i.test(msg)) {
      return "Ce numéro est déjà vérifié. Connecte-toi ou réessaie la récupération.";
    }
    return msg || "Impossible d'envoyer le code. Réessaie.";
  }

  if (
    e?.status === 404 ||
    /introuvable|aucun compte|n'est pas reconnu|pas dans notre système/i.test(msg)
  ) {
    return "Ce numéro n'est pas reconnu.";
  }

  if (contexte === "backoffice") {
    if (/non autorisé/i.test(msg)) return "Accès non autorisé pour ce rôle.";
  }

  if (e?.status === 401 || /identifiants incorrects/i.test(msg)) {
    return "Mot de passe incorrect. Réessaie.";
  }

  if (/syntaxerror|sql\b|stack|paytech|whatsapp|<html|exception/i.test(msg)) {
    // Le contexte "otp" est déjà traité plus haut (retour anticipé).
    return "Mot de passe incorrect. Réessaie.";
  }

  return msg || "Mot de passe incorrect. Réessaie.";
}

export function forceMotDePasse(password: string): "empty" | "weak" | "medium" | "strong" {
  if (!password) return "empty";
  if (password.length < 6) return "weak";
  if (password.length <= 8) return "medium";
  if (password.length > 8 && /[A-Z]/.test(password)) return "strong";
  return "medium";
}
