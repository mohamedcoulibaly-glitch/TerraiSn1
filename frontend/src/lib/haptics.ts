/** Retours haptiques légers pour mobile (Vibration API) */

type HapticPattern = 'light' | 'medium' | 'success' | 'error';

const PATTERNS: Record<HapticPattern, number | number[]> = {
  light: 10,
  medium: [15, 30, 15],
  success: [20, 40, 20],
  error: [30, 20, 30, 20, 30],
};

export function hapticFeedback(pattern: HapticPattern = 'light'): void {
  if (typeof navigator === 'undefined' || !('vibrate' in navigator)) return;
  try {
    navigator.vibrate(PATTERNS[pattern]);
  } catch {
    /* API non supportée */
  }
}

export function hapticSelection(): void {
  hapticFeedback('light');
}

export function hapticSuccess(): void {
  hapticFeedback('success');
}

export function hapticError(): void {
  hapticFeedback('error');
}
