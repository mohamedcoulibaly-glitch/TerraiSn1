/** Retours haptiques légers pour mobile (Vibration API) */

type HapticPattern = 'light' | 'medium' | 'success' | 'error';

const PATTERNS: Record<HapticPattern, number | number[]> = {
  light: 10,
  medium: [15, 30, 15],
  success: [20, 40, 20],
  error: [30, 20, 30, 20, 30],
};

/**
 * Déclenche une vibration courte (feel natif).
 * No-op si l’API n’est pas supportée (iOS Safari, desktop…).
 */
export function triggerHapticFeedback(ms = 10): void {
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
  try {
    navigator.vibrate(ms);
  } catch {
    /* API non supportée ou bloquée */
  }
}

export function hapticFeedback(pattern: HapticPattern = 'light'): void {
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
  try {
    navigator.vibrate(PATTERNS[pattern]);
  } catch {
    /* API non supportée */
  }
}

export function hapticSelection(): void {
  triggerHapticFeedback(10);
}

export function hapticSuccess(): void {
  hapticFeedback('success');
}

export function hapticError(): void {
  hapticFeedback('error');
}
