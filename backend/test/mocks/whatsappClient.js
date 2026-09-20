/**
 * Double de test pour le client WhatsApp OpenWA.
 * Permet de simuler succès, échec HTTP 500, et d'inspecter les payloads.
 */
function creerWhatsappDouble() {
  /** @type {Array<{ session: string, chatId: string, message: string }>} */
  const sent = [];
  /** @type {Array<{ session: string, chatId: string, media: object }>} */
  const images = [];
  let failNext = false;
  let failAlways = false;
  let failStatus = 500;

  async function sendMessageForSession(session, chatId, message) {
    if (failAlways || failNext) {
      failNext = false;
      const err = new Error(`OpenWA HTTP ${failStatus}`);
      err.statusCode = failStatus;
      err.status = failStatus;
      throw err;
    }
    sent.push({ session: String(session), chatId: String(chatId), message: String(message) });
    return { ok: true };
  }

  async function sendImageForSession(session, chatId, media) {
    if (failAlways || failNext) {
      failNext = false;
      const err = new Error(`OpenWA HTTP ${failStatus}`);
      err.statusCode = failStatus;
      err.status = failStatus;
      throw err;
    }
    images.push({ session: String(session), chatId: String(chatId), media });
    return { ok: true };
  }

  return {
    sent,
    images,
    sendMessageForSession,
    sendImageForSession,
    failOnce(status = 500) {
      failNext = true;
      failStatus = status;
    },
    failPermanently(status = 500) {
      failAlways = true;
      failStatus = status;
    },
    recover() {
      failAlways = false;
      failNext = false;
    },
    reset() {
      sent.length = 0;
      images.length = 0;
      failAlways = false;
      failNext = false;
    },
    /** Branche le double sur le module whatsappClient déjà chargé. */
    installerSur(clientModule) {
      clientModule.sendMessageForSession = sendMessageForSession;
      clientModule.sendImageForSession = sendImageForSession;
    },
  };
}

module.exports = { creerWhatsappDouble };
