/**
 * Sons des toasts — Web Audio API (aucun fichier audio).
 *  - succès : un bip 880 Hz, 150 ms, gain 0.25
 *  - erreur : deux bips courts 440 Hz
 *  - warning / info : silencieux
 *
 * Les navigateurs bloquent l'audio tant qu'aucun geste utilisateur n'a eu lieu : le contexte
 * est donc créé paresseusement et « débloqué » au premier pointerdown / keydown.
 */

const STORAGE_KEY = 'terrainsn_toast_sound';
const MIN_GAP_MS = 220;

type AudioCtor = typeof AudioContext;

let ctx: AudioContext | null = null;
let lastPlayAt = 0;
let unlockInstalled = false;

function getAudioCtor(): AudioCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { AudioContext?: AudioCtor; webkitAudioContext?: AudioCtor };
  return w.AudioContext || w.webkitAudioContext || null;
}

function getContext(): AudioContext | null {
  if (ctx) return ctx;
  const Ctor = getAudioCtor();
  if (!Ctor) return null;
  try {
    ctx = new Ctor();
  } catch {
    ctx = null;
  }
  return ctx;
}

/** Active/désactive les sons (persisté). Activé par défaut. */
export function isToastSoundEnabled(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== 'off';
  } catch {
    return true;
  }
}

export function setToastSoundEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, enabled ? 'on' : 'off');
  } catch {
    /* stockage indisponible */
  }
}

/** À appeler une fois : reprend le contexte audio au premier geste utilisateur. */
export function installToastSoundUnlock(): void {
  if (unlockInstalled || typeof window === 'undefined') return;
  unlockInstalled = true;
  const unlock = () => {
    const c = getContext();
    if (c && c.state === 'suspended') void c.resume().catch(() => undefined);
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
  };
  window.addEventListener('pointerdown', unlock, { passive: true });
  window.addEventListener('keydown', unlock);
}

interface BeepOptions {
  frequency: number;
  /** début en secondes depuis maintenant */
  startAfter: number;
  /** durée en ms */
  durationMs: number;
  gain: number;
}

function scheduleBeep(c: AudioContext, { frequency, startAfter, durationMs, gain }: BeepOptions): void {
  const osc = c.createOscillator();
  const amp = c.createGain();
  const start = c.currentTime + startAfter;
  const end = start + durationMs / 1000;

  osc.type = 'sine';
  osc.frequency.setValueAtTime(frequency, start);

  // enveloppe courte pour éviter les « clics » en début/fin de bip
  amp.gain.setValueAtTime(0.0001, start);
  amp.gain.exponentialRampToValueAtTime(gain, start + 0.012);
  amp.gain.setValueAtTime(gain, Math.max(start + 0.012, end - 0.03));
  amp.gain.exponentialRampToValueAtTime(0.0001, end);

  osc.connect(amp);
  amp.connect(c.destination);
  osc.start(start);
  osc.stop(end + 0.02);
  osc.onended = () => {
    osc.disconnect();
    amp.disconnect();
  };
}

function play(beeps: BeepOptions[]): void {
  if (!isToastSoundEnabled()) return;
  const now = Date.now();
  if (now - lastPlayAt < MIN_GAP_MS) return;
  const c = getContext();
  if (!c) return;
  lastPlayAt = now;
  const run = () => beeps.forEach((beep) => scheduleBeep(c, beep));
  if (c.state === 'suspended') {
    // sans geste utilisateur le resume() est rejeté : on ignore silencieusement
    void c.resume().then(run).catch(() => undefined);
  } else {
    run();
  }
}

/** 880 Hz — 150 ms — gain 0.25 */
export function playSuccessSound(): void {
  play([{ frequency: 880, startAfter: 0, durationMs: 150, gain: 0.25 }]);
}

/** Deux bips courts 440 Hz */
export function playErrorSound(): void {
  play([
    { frequency: 440, startAfter: 0, durationMs: 110, gain: 0.25 },
    { frequency: 440, startAfter: 0.18, durationMs: 110, gain: 0.25 },
  ]);
}
