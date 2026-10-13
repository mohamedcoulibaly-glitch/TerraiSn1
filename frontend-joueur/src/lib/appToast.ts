/**
 * Enveloppe sonner : sons (succès / erreur) appliqués à TOUS les appels `toast.success|error`
 * du projet sans réécrire les imports existants.
 *
 * `installToastSounds()` remplace de façon idempotente `toast.success` et `toast.error`
 * par des versions qui jouent le son puis délèguent à sonner. Warning / info restent muets.
 */
import { toast } from "sonner";
import type { ExternalToast } from "sonner";
import { installToastSoundUnlock, playErrorSound, playSuccessSound } from "@/lib/toastSound";

type ToastMessage = Parameters<typeof toast>[0];
type ToastFn = (message: ToastMessage, data?: ExternalToast) => string | number;

const PATCHED = Symbol.for("terrainsn.toast.sounds");

export function installToastSounds(): void {
  const target = toast as unknown as Record<string | symbol, unknown>;
  if (target[PATCHED]) return;
  target[PATCHED] = true;
  installToastSoundUnlock();

  const originalSuccess = toast.success as ToastFn;
  const originalError = toast.error as ToastFn;

  target.success = ((message: ToastMessage, data?: ExternalToast) => {
    playSuccessSound();
    return originalSuccess.call(toast, message, data);
  }) as ToastFn;

  target.error = ((message: ToastMessage, data?: ExternalToast) => {
    playErrorSound();
    return originalError.call(toast, message, data);
  }) as ToastFn;
}

/** API typée, sans état — utilisable hors composants (services, handlers). */
export const appToast = {
  success: (message: ToastMessage, data?: ExternalToast) => toast.success(message, data),
  error: (message: ToastMessage, data?: ExternalToast) => toast.error(message, data),
  warning: (message: ToastMessage, data?: ExternalToast) => toast.warning(message, data),
  info: (message: ToastMessage, data?: ExternalToast) => toast.info(message, data),
  dismiss: (id?: string | number) => toast.dismiss(id),
};

export type AppToast = typeof appToast;
