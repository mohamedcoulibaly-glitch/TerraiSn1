import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Clock3, FlipHorizontal, Keyboard, X, XCircle } from "lucide-react";
import jsQR from "jsqr";
import { Button } from "@/components/ui/button";
import { gerantApi } from "@/lib/api";
import { parseQrPayload } from "@/lib/qrPayload";

export { parseQrPayload } from "@/lib/qrPayload";

type ScanState = "scan" | "too_early" | "expired" | "success" | "invalid" | "already_scanned";

type ReservationRecap = {
  id?: number;
  joueur_nom?: string;
  terrain_nom?: string;
  date?: string;
  heure_debut?: string;
  heure_fin?: string;
  code_reservation?: string;
  statut?: string;
  qr_code_scanne_at?: string;
};

type ScanResult = {
  state: ScanState;
  title?: string;
  text?: string;
  reservation?: ReservationRecap;
};

type ScannerModalProps = {
  open: boolean;
  onClose: () => void;
  expectedReservationId: number | string;
  expectedCodeReservation?: string | null;
  onSuccess?: (reservation: ReservationRecap) => void;
};

type CameraFacing = "environment" | "user";

function formatDate(value?: string) {
  if (!value) return "-";
  return new Date(`${value}T00:00:00`).toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
  });
}

function formatTime(value?: string) {
  if (!value) return "-";
  return String(value).slice(0, 5);
}

function formatDateTime(value?: string) {
  if (!value) return "-";
  const raw = String(value).trim();
  const date = new Date(raw.includes("T") ? raw : raw.replace(" ", "T"));
  if (Number.isNaN(date.getTime())) return raw;
  return date.toLocaleString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function isRearCameraLabel(label: string): boolean {
  return /back|rear|environment|arri[eè]re|world|facing\s*back|camera2\s*0/i.test(label);
}

function isFrontCameraLabel(label: string): boolean {
  return /front|user|selfie|face|facade|avant|facing\s*front/i.test(label);
}

async function unlockCameraLabels(): Promise<void> {
  // Les labels restent vides tant qu'aucune permission caméra n'a été accordée.
  const warm = await navigator.mediaDevices.getUserMedia({ audio: false, video: true });
  warm.getTracks().forEach((t) => t.stop());
}

async function pickPreferredDeviceId(facing: CameraFacing): Promise<string | undefined> {
  const devices = await navigator.mediaDevices.enumerateDevices();
  const cams = devices.filter((d) => d.kind === "videoinput");
  if (cams.length === 0) return undefined;

  const scored = cams.map((cam, index) => {
    const label = cam.label || "";
    let score = 50;
    if (facing === "environment") {
      if (isRearCameraLabel(label)) score = 100;
      else if (isFrontCameraLabel(label)) score = 0;
      // Labels génériques : souvent la dernière = arrière (surtout mobile).
      else if (cams.length > 1 && index === cams.length - 1) score = 70;
    } else {
      if (isFrontCameraLabel(label)) score = 100;
      else if (isRearCameraLabel(label)) score = 0;
      else if (index === 0) score = 70;
    }
    return { cam, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.cam.deviceId;
}

async function openCameraStream(facing: CameraFacing = "environment"): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("Caméra non supportée sur ce navigateur");
  }

  await unlockCameraLabels().catch(() => undefined);

  const deviceId = await pickPreferredDeviceId(facing).catch(() => undefined);

  if (deviceId) {
    try {
      return await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          deviceId: { exact: deviceId },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      });
    } catch {
      // fallback ci-dessous
    }
  }

  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { exact: facing },
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
    });
  } catch {
    try {
      return await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: facing },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      });
    } catch {
      // PC avec une seule webcam : souvent frontale uniquement
      return navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    }
  }
}

export default function ScannerModal({
  open,
  onClose,
  expectedReservationId,
  expectedCodeReservation,
  onSuccess,
}: ScannerModalProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanningRef = useRef(false);
  const rafRef = useRef<number | null>(null);
  const facingRef = useRef<CameraFacing>("environment");
  const [result, setResult] = useState<ScanResult>({ state: "scan" });
  const [flash, setFlash] = useState<"green" | "red" | null>(null);
  const [manualCode, setManualCode] = useState("");
  const [showManual, setShowManual] = useState(false);
  const [hint, setHint] = useState("Place le QR bien en face, bien éclairé");
  const [facing, setFacing] = useState<CameraFacing>("environment");

  const stopCamera = useCallback(() => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    scanningRef.current = false;
  }, []);

  const triggerFlash = useCallback((color: "green" | "red") => {
    setFlash(color);
    window.setTimeout(() => setFlash(null), 500);
  }, []);

  const matchesExpected = useCallback(
    (parsed: { id: string; code: string }) => {
      const expectedId = String(expectedReservationId);
      const expectedCode = String(expectedCodeReservation || "")
        .trim()
        .toUpperCase();
      if (parsed.id && parsed.id === expectedId) return true;
      if (parsed.code && expectedCode && parsed.code === expectedCode) return true;
      return false;
    },
    [expectedReservationId, expectedCodeReservation],
  );

  const submitScan = useCallback(
    async (rawValue: string) => {
      scanningRef.current = false;
      stopCamera();

      const parsed = parseQrPayload(rawValue);
      if (!matchesExpected(parsed)) {
        triggerFlash("red");
        setResult({
          state: "invalid",
          title: "QR code non reconnu",
          text: `Ce code ne correspond pas à cette réservation${
            expectedCodeReservation ? ` (attendu : ${expectedCodeReservation})` : ""
          }.`,
        });
        return;
      }

      try {
        const payload = (await gerantApi.scanQr(
          expectedReservationId,
          "especes",
          parsed.raw || rawValue,
        )) as {
          reservation?: ReservationRecap;
        };
        triggerFlash("green");
        setResult({
          state: "success",
          title: "Match validé",
          reservation: payload.reservation,
        });
        if (payload.reservation) onSuccess?.(payload.reservation);
      } catch (err) {
        const error = err as Error & {
          code?: string;
          status?: number;
          scannable_at?: string;
          minutes_remaining?: number;
          match_date?: string;
          match_time?: string;
          qr_code_scanne_at?: string;
        };

        if (error.code === "QR_SCAN_TOO_EARLY") {
          setResult({
            state: "too_early",
            title: "C'est un peu tôt",
            text: error.scannable_at
              ? `Tu pourras scanner ce QR code à partir de ${new Date(error.scannable_at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}. Reviens dans ${error.minutes_remaining || 1} minutes.`
              : error.message,
          });
          return;
        }
        if (error.code === "QR_SCAN_EXPIRED") {
          setResult({
            state: "expired",
            title: "Ce QR code a expiré",
            text: `Ce match était prévu le ${formatDate(error.match_date)} à ${formatTime(error.match_time)}. Le délai de validation est dépassé.`,
          });
          return;
        }
        if (error.status === 403 || error.code === "QR_ALREADY_SCANNED") {
          triggerFlash("red");
          setResult({
            state: "already_scanned",
            title: "QR déjà scanné",
            text:
              error.message ||
              `Erreur : Ce code QR a déjà été scanné le ${formatDateTime(error.qr_code_scanne_at)}`,
          });
          return;
        }

        triggerFlash("red");
        setResult({
          state: "invalid",
          title: "Scan refusé",
          text: error.message || "Ce code ne correspond à aucune réservation valide.",
        });
      }
    },
    [expectedCodeReservation, expectedReservationId, matchesExpected, onSuccess, stopCamera, triggerFlash],
  );

  const startCamera = useCallback(async (nextFacing: CameraFacing = facingRef.current) => {
    stopCamera();
    setResult({ state: "scan" });
    setHint("Place le QR bien en face, bien éclairé");
    setShowManual(false);
    facingRef.current = nextFacing;
    setFacing(nextFacing);

    const stream = await openCameraStream(nextFacing);
    streamRef.current = stream;

    if (videoRef.current) {
      videoRef.current.srcObject = stream;
      videoRef.current.setAttribute("playsinline", "true");
      // Miroir seulement pour selfie (caméra avant)
      videoRef.current.style.transform = nextFacing === "user" ? "scaleX(-1)" : "none";
      await videoRef.current.play();
    }
    scanningRef.current = true;

    const BarcodeDetectorCtor = (
      window as unknown as {
        BarcodeDetector?: new (opts: { formats: string[] }) => {
          detect: (source: HTMLVideoElement) => Promise<Array<{ rawValue?: string }>>;
        };
      }
    ).BarcodeDetector;

    const detector = BarcodeDetectorCtor
      ? new BarcodeDetectorCtor({ formats: ["qr_code"] })
      : null;

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    let frames = 0;

    const scanLoop = async () => {
      if (!scanningRef.current || !videoRef.current) return;
      const video = videoRef.current;
      frames += 1;

      if (frames === 90) {
        setHint("Toujours rien ? Approach le QR ou saisis le code manuellement");
        setShowManual(true);
      }

      try {
        if (detector) {
          const codes = await detector.detect(video);
          const raw = codes?.[0]?.rawValue;
          if (raw) {
            await submitScan(raw);
            return;
          }
        }

        if (ctx && video.readyState >= video.HAVE_ENOUGH_DATA && video.videoWidth > 0) {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const code = jsQR(imageData.data, imageData.width, imageData.height, {
            inversionAttempts: "attemptBoth",
          });
          if (code?.data) {
            await submitScan(code.data);
            return;
          }
        }
      } catch {
        // frame pas prête
      }

      rafRef.current = window.requestAnimationFrame(() => {
        void scanLoop();
      });
    };

    rafRef.current = window.requestAnimationFrame(() => {
      void scanLoop();
    });
  }, [stopCamera, submitScan]);

  useEffect(() => {
    if (!open) {
      stopCamera();
      setResult({ state: "scan" });
      setFlash(null);
      setManualCode("");
      setShowManual(false);
      facingRef.current = "environment";
      setFacing("environment");
      return;
    }
    startCamera("environment").catch((err) => {
      setShowManual(true);
      setResult({
        state: "invalid",
        title: "Caméra indisponible",
        text:
          err instanceof Error
            ? `${err.message}. Tu peux saisir le code manuellement.`
            : "Impossible d'activer la caméra. Vérifie les permissions puis réessaie.",
      });
    });
    return stopCamera;
  }, [open, startCamera, stopCamera]);

  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        stopCamera();
        onClose();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open, stopCamera, onClose]);

  const flipCamera = () => {
    const next: CameraFacing = facingRef.current === "environment" ? "user" : "environment";
    startCamera(next).catch(() => {
      setShowManual(true);
      setResult({
        state: "invalid",
        title: "Caméra indisponible",
        text: "Impossible de basculer la caméra.",
      });
    });
  };

  const retry = () => {
    setManualCode("");
    startCamera(facingRef.current).catch(() => {
      setShowManual(true);
      setResult({
        state: "invalid",
        title: "Caméra indisponible",
        text: "Impossible d'activer la caméra. Vérifie les permissions puis réessaie.",
      });
    });
  };

  const submitManual = () => {
    const value = manualCode.trim();
    if (!value) return;
    scanningRef.current = true;
    void submitScan(value);
  };

  if (!open) return null;

  const canRetry = result.state === "invalid" || result.state === "too_early";

  return (
    <div
      className="fixed inset-0 z-[80] bg-black text-white overflow-hidden"
      role="dialog"
      aria-modal="true"
      aria-label="Scanner QR"
    >
      <style>{`
        @keyframes scan-line { 0% { transform: translateY(-8px); } 100% { transform: translateY(226px); } }
        @keyframes scan-corner { 0%, 100% { opacity: .55; } 50% { opacity: 1; } }
        @keyframes pop-check { 0% { transform: scale(.65); opacity: .2; } 100% { transform: scale(1); opacity: 1; } }
      `}</style>
      <video ref={videoRef} className="absolute inset-0 h-full w-full object-cover" muted playsInline autoPlay />
      <div className="absolute inset-0 bg-black/25" />

      {flash && (
        <div
          className={`absolute inset-0 z-30 ${flash === "green" ? "bg-[var(--color-success)]" : "bg-[var(--color-danger)]"} opacity-70`}
        />
      )}

      <button
        type="button"
        onClick={() => {
          stopCamera();
          onClose();
        }}
        className="absolute right-4 top-4 z-20 inline-flex h-11 w-11 items-center justify-center rounded-full bg-black/35 backdrop-blur"
        aria-label="Fermer"
      >
        <X className="h-5 w-5" />
      </button>

      {result.state === "scan" && (
        <button
          type="button"
          onClick={flipCamera}
          className="absolute left-4 top-4 z-20 inline-flex h-11 w-11 items-center justify-center rounded-full bg-black/35 backdrop-blur"
          aria-label={facing === "environment" ? "Passer en caméra selfie" : "Passer en caméra arrière"}
          title={facing === "environment" ? "Caméra selfie" : "Caméra arrière"}
        >
          <FlipHorizontal className="h-5 w-5" />
        </button>
      )}

      {result.state === "scan" && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center px-6">
          <div className="relative h-64 w-64 max-w-[78vw] rounded-[28px]">
            <span
              className="absolute left-0 top-0 h-12 w-12 rounded-tl-[28px] border-l-4 border-t-4 border-[var(--color-primary)]"
              style={{ animation: "scan-corner 1.4s ease-in-out infinite" }}
            />
            <span
              className="absolute right-0 top-0 h-12 w-12 rounded-tr-[28px] border-r-4 border-t-4 border-[var(--color-primary)]"
              style={{ animation: "scan-corner 1.4s ease-in-out infinite" }}
            />
            <span
              className="absolute bottom-0 left-0 h-12 w-12 rounded-bl-[28px] border-b-4 border-l-4 border-[var(--color-primary)]"
              style={{ animation: "scan-corner 1.4s ease-in-out infinite" }}
            />
            <span
              className="absolute bottom-0 right-0 h-12 w-12 rounded-br-[28px] border-b-4 border-r-4 border-[var(--color-primary)]"
              style={{ animation: "scan-corner 1.4s ease-in-out infinite" }}
            />
            <span
              className="absolute left-5 right-5 top-4 h-0.5 bg-[var(--color-primary)] shadow-[0_0_18px_var(--color-primary)]"
              style={{ animation: "scan-line 1.8s linear infinite alternate" }}
            />
          </div>
          <p className="mt-5 text-sm text-white/80 text-center max-w-sm">{hint}</p>
          {expectedCodeReservation ? (
            <p className="mt-2 text-xs text-white/55 text-center">
              Code attendu : <span className="font-semibold text-white">{expectedCodeReservation}</span>
            </p>
          ) : null}

          <div className="mt-4 w-full max-w-sm">
            {!showManual ? (
              <button
                type="button"
                onClick={() => setShowManual(true)}
                className="mx-auto flex items-center gap-2 text-xs text-white/70 underline underline-offset-2"
              >
                <Keyboard className="w-3.5 h-3.5" />
                Saisir le code manuellement
              </button>
            ) : (
              <div className="rounded-2xl bg-black/55 backdrop-blur p-3 space-y-2 border border-white/15">
                <label className="text-xs text-white/70">Code (ex. TF-MOH-2H)</label>
                <input
                  value={manualCode}
                  onChange={(e) => setManualCode(e.target.value.toUpperCase())}
                  placeholder={expectedCodeReservation || "TF-XXXXXX"}
                  className="w-full h-11 rounded-xl bg-white text-[var(--color-text-primary)] px-3 text-sm font-semibold tracking-wide outline-none"
                  autoCapitalize="characters"
                />
                <Button type="button" variant="hero" className="w-full" onClick={submitManual}>
                  Valider ce code
                </Button>
              </div>
            )}
          </div>
        </div>
      )}

      {result.state !== "scan" && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/70 px-5">
          <section className="w-full max-w-sm rounded-[var(--radius-lg)] bg-white p-6 text-center text-[var(--color-text-primary)] shadow-xl">
            {result.state === "too_early" && <Clock3 className="mx-auto h-12 w-12 text-[var(--color-warning)]" />}
            {(result.state === "expired" || result.state === "already_scanned") && (
              <AlertTriangle className="mx-auto h-12 w-12 text-[var(--color-danger)]" />
            )}
            {result.state === "invalid" && <XCircle className="mx-auto h-12 w-12 text-[var(--color-danger)]" />}
            {result.state === "success" && (
              <CheckCircle2
                className="mx-auto h-14 w-14 text-[var(--color-success)]"
                style={{ animation: "pop-check .25s ease-out both" }}
              />
            )}

            <h1 className="mt-4 text-xl font-bold" style={{ fontFamily: "var(--font-display)" }}>
              {result.title}
            </h1>
            {result.text && <p className="mt-2 text-sm text-[var(--color-text-secondary)]">{result.text}</p>}

            {result.state === "success" && result.reservation && (
              <div className="mt-5 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-2)] p-4 text-left text-sm">
                <p>
                  <span className="text-[var(--color-text-secondary)]">Joueur</span>
                  <span className="float-right font-semibold">{result.reservation.joueur_nom || "-"}</span>
                </p>
                <p className="mt-2">
                  <span className="text-[var(--color-text-secondary)]">Terrain</span>
                  <span className="float-right font-semibold">{result.reservation.terrain_nom || "-"}</span>
                </p>
                <p className="mt-2">
                  <span className="text-[var(--color-text-secondary)]">Match</span>
                  <span className="float-right font-semibold">
                    {formatDate(result.reservation.date)} {formatTime(result.reservation.heure_debut)}
                  </span>
                </p>
                <p className="mt-2">
                  <span className="text-[var(--color-text-secondary)]">Code</span>
                  <span className="float-right font-semibold">{result.reservation.code_reservation || "-"}</span>
                </p>
              </div>
            )}

            {/* Fallback manuel aussi après échec caméra */}
            {result.state === "invalid" && (
              <div className="mt-4 text-left space-y-2">
                <label className="text-xs text-[var(--color-text-muted)]">Ou saisis le code</label>
                <input
                  value={manualCode}
                  onChange={(e) => setManualCode(e.target.value.toUpperCase())}
                  placeholder={expectedCodeReservation || "TF-XXXXXX"}
                  className="w-full h-11 rounded-xl border border-[var(--color-border)] px-3 text-sm font-semibold"
                />
                <Button type="button" variant="outline" className="w-full" onClick={submitManual}>
                  Valider ce code
                </Button>
              </div>
            )}

            <div className="mt-6 flex flex-col gap-2">
              {canRetry && (
                <Button type="button" variant="hero" className="w-full" onClick={retry}>
                  Réessayer la caméra
                </Button>
              )}
              <Button
                type="button"
                variant={canRetry ? "outline" : "hero"}
                className="w-full"
                onClick={() => {
                  stopCamera();
                  onClose();
                }}
              >
                Fermer
              </Button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
