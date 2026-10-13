import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const oscillators: Array<{ frequency: { setValueAtTime: ReturnType<typeof vi.fn> } }> = [];

class FakeAudioContext {
  currentTime = 0;
  state = "running";
  destination = {};
  createOscillator() {
    const osc = {
      type: "sine",
      frequency: { setValueAtTime: vi.fn() },
      connect: vi.fn(),
      disconnect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
      onended: null as null | (() => void),
    };
    oscillators.push(osc);
    return osc;
  }
  createGain() {
    return {
      gain: {
        setValueAtTime: vi.fn(),
        exponentialRampToValueAtTime: vi.fn(),
      },
      connect: vi.fn(),
      disconnect: vi.fn(),
    };
  }
  resume() {
    return Promise.resolve();
  }
}

describe("sons des toasts (Web Audio)", () => {
  beforeEach(() => {
    vi.resetModules();
    oscillators.length = 0;
    localStorage.clear();
    vi.stubGlobal("AudioContext", FakeAudioContext);
    (window as unknown as { AudioContext: unknown }).AudioContext = FakeAudioContext;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("succès : un bip à 880 Hz", async () => {
    const { playSuccessSound } = await import("./toastSound");
    playSuccessSound();
    expect(oscillators).toHaveLength(1);
    expect(oscillators[0].frequency.setValueAtTime.mock.calls[0][0]).toBe(880);
  });

  it("erreur : deux bips à 440 Hz", async () => {
    const { playErrorSound } = await import("./toastSound");
    playErrorSound();
    expect(oscillators).toHaveLength(2);
    expect(oscillators.every((o) => o.frequency.setValueAtTime.mock.calls[0][0] === 440)).toBe(true);
  });

  it("désactivable via la préférence locale", async () => {
    const { playSuccessSound, setToastSoundEnabled } = await import("./toastSound");
    setToastSoundEnabled(false);
    playSuccessSound();
    expect(oscillators).toHaveLength(0);
  });

  it("toast.success / toast.error jouent un son, warning / info restent muets", async () => {
    const { toast } = await import("sonner");
    const { installToastSounds } = await import("./appToast");
    installToastSounds();
    installToastSounds(); // idempotent

    toast.success("ok");
    expect(oscillators).toHaveLength(1);

    // le garde anti-spam (220 ms) empêche deux sons rapprochés
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 500);
    toast.error("ko");
    expect(oscillators).toHaveLength(3);

    vi.setSystemTime(Date.now() + 500);
    toast.warning("attention");
    toast.info("info");
    expect(oscillators).toHaveLength(3);
  });
});
