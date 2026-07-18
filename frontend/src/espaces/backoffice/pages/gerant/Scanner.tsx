import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, ArrowLeft, CheckCircle2, Clock3, XCircle } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { authApi } from "@/lib/api";

type ScanState = "scan" | "too_early" | "expired" | "success" | "invalid";

type ReservationRecap = {
  joueur_nom?: string;
  terrain_nom?: string;
  date?: string;
  heure_debut?: string;
  heure_fin?: string;
  code_reservation?: string;
};

type ScanResult = {
  state: ScanState;
  title?: string;
  text?: string;
  reservation?: ReservationRecap;
};

const API_URL = import.meta.env.VITE_API_URL || "/api";

function parseReservationId(rawValue: string) {
  const raw = String(rawValue || "").trim();
  const urlMatch = raw.match(/(?:reservation_id|id)=([0-9]+)/i);
  if (urlMatch) return urlMatch[1];
  const pathMatch = raw.match(/reservations?\/([0-9]+)/i);
  if (pathMatch) return pathMatch[1];
  const numberMatch = raw.match(/\b([0-9]{1,12})\b/);
  return numberMatch?.[1] || "";
}

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

export default function ScannerGerant() {
  const navigate = useNavigate();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanningRef = useRef(false);
  const [result, setResult] = useState<ScanResult>({ state: "scan" });
  const [flash, setFlash] = useState<"green" | "red" | null>(null);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    scanningRef.current = false;
  }, []);

  const triggerFlash = useCallback((color: "green" | "red") => {
    setFlash(color);
    window.setTimeout(() => setFlash(null), 500);
  }, []);

  const submitScan = useCallback(async (reservationId: string) => {
    if (!reservationId || !scanningRef.current) return;
    scanningRef.current = false;
    stopCamera();

    try {
      const response = await fetch(`${API_URL}/gerant/reservations/${reservationId}/scanner`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authApi.getToken() || ""}`,
        },
        body: JSON.stringify({ methode: "especes" }),
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        if (payload.code === "QR_SCAN_TOO_EARLY") {
          setResult({
            state: "too_early",
            title: "C'est un peu tôt 😄",
            text: `Tu pourras scanner ce QR code à partir de ${new Date(payload.scannable_at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}. Reviens dans ${payload.minutes_remaining || 1} minutes.`,
          });
          return;
        }
        if (payload.code === "QR_SCAN_EXPIRED") {
          setResult({
            state: "expired",
            title: "Ce QR code a expiré",
            text: `Ce match était prévu le ${formatDate(payload.match_date)} à ${formatTime(payload.match_time)}. Le délai de validation est dépassé. Si c'est une erreur, contacte l'administration.`,
          });
          return;
        }
        triggerFlash("red");
        setResult({
          state: "invalid",
          title: "QR code non reconnu",
          text: "Ce code ne correspond à aucune réservation valide.",
        });
        return;
      }

      triggerFlash("green");
      setResult({
        state: "success",
        title: "Match validé ✅",
        reservation: payload.reservation,
      });
    } catch {
      triggerFlash("red");
      setResult({
        state: "invalid",
        title: "QR code non reconnu",
        text: "Ce code ne correspond à aucune réservation valide.",
      });
    }
  }, [stopCamera, triggerFlash]);

  const startCamera = useCallback(async () => {
    stopCamera();
    setResult({ state: "scan" });
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment" },
      audio: false,
    });
    streamRef.current = stream;
    if (videoRef.current) {
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
    }
    scanningRef.current = true;

    const BarcodeDetectorCtor = (window as any).BarcodeDetector;
    if (!BarcodeDetectorCtor) return;
    const detector = new BarcodeDetectorCtor({ formats: ["qr_code"] });

    const scanLoop = async () => {
      if (!scanningRef.current || !videoRef.current) return;
      try {
        const codes = await detector.detect(videoRef.current);
        const raw = codes?.[0]?.rawValue;
        if (raw) {
          await submitScan(parseReservationId(raw));
          return;
        }
      } catch {
        // Camera frames may not be ready on the first iterations.
      }
      window.requestAnimationFrame(scanLoop);
    };
    window.requestAnimationFrame(scanLoop);
  }, [stopCamera, submitScan]);

  useEffect(() => {
    startCamera().catch(() => {
      setResult({
        state: "invalid",
        title: "Camera indisponible",
        text: "Impossible d'activer la caméra. Vérifie les permissions puis réessaie.",
      });
    });
    return stopCamera;
  }, [startCamera, stopCamera]);

  const reset = () => {
    startCamera().catch(() => {
      setResult({
        state: "invalid",
        title: "Camera indisponible",
        text: "Impossible d'activer la caméra. Vérifie les permissions puis réessaie.",
      });
    });
  };

  return (
    <main className="fixed inset-0 z-50 bg-black text-white overflow-hidden">
      <style>{`
        @keyframes scan-line { 0% { transform: translateY(-8px); } 100% { transform: translateY(226px); } }
        @keyframes scan-corner { 0%, 100% { opacity: .55; } 50% { opacity: 1; } }
        @keyframes pop-check { 0% { transform: scale(.65); opacity: .2; } 100% { transform: scale(1); opacity: 1; } }
      `}</style>
      <video ref={videoRef} className="absolute inset-0 h-full w-full object-cover" muted playsInline />
      <div className="absolute inset-0 bg-black/25" />

      {flash && <div className={`absolute inset-0 z-30 ${flash === "green" ? "bg-[var(--color-success)]" : "bg-[var(--color-danger)]"} opacity-70`} />}

      <button
        type="button"
        onClick={() => navigate(-1)}
        className="absolute left-4 top-4 z-20 inline-flex h-11 w-11 items-center justify-center rounded-full bg-black/35 backdrop-blur"
        aria-label="Retour"
      >
        <ArrowLeft className="h-5 w-5" />
      </button>

      {result.state === "scan" && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center px-6">
          <div className="relative h-64 w-64 max-w-[78vw] rounded-[28px]">
            <span className="absolute left-0 top-0 h-12 w-12 rounded-tl-[28px] border-l-4 border-t-4 border-[var(--color-primary)]" style={{ animation: "scan-corner 1.4s ease-in-out infinite" }} />
            <span className="absolute right-0 top-0 h-12 w-12 rounded-tr-[28px] border-r-4 border-t-4 border-[var(--color-primary)]" style={{ animation: "scan-corner 1.4s ease-in-out infinite" }} />
            <span className="absolute bottom-0 left-0 h-12 w-12 rounded-bl-[28px] border-b-4 border-l-4 border-[var(--color-primary)]" style={{ animation: "scan-corner 1.4s ease-in-out infinite" }} />
            <span className="absolute bottom-0 right-0 h-12 w-12 rounded-br-[28px] border-b-4 border-r-4 border-[var(--color-primary)]" style={{ animation: "scan-corner 1.4s ease-in-out infinite" }} />
            <span className="absolute left-5 right-5 top-4 h-0.5 bg-[var(--color-primary)] shadow-[0_0_18px_var(--color-primary)]" style={{ animation: "scan-line 1.8s linear infinite alternate" }} />
          </div>
          <p className="mt-5 text-sm text-white/75">Place le QR code dans le cadre</p>
        </div>
      )}

      {result.state !== "scan" && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/70 px-5">
          <section className="w-full max-w-sm rounded-[var(--radius-lg)] bg-white p-6 text-center text-[var(--color-text-primary)] shadow-xl">
            {result.state === "too_early" && <Clock3 className="mx-auto h-12 w-12 text-[var(--color-warning)]" />}
            {result.state === "expired" && <AlertTriangle className="mx-auto h-12 w-12 text-[var(--color-danger)]" />}
            {result.state === "invalid" && <XCircle className="mx-auto h-12 w-12 text-[var(--color-danger)]" />}
            {result.state === "success" && (
              <CheckCircle2 className="mx-auto h-14 w-14 text-[var(--color-success)]" style={{ animation: "pop-check .25s ease-out both" }} />
            )}

            <h1 className="mt-4 text-xl font-bold" style={{ fontFamily: "var(--font-display)" }}>
              {result.title}
            </h1>
            {result.text && <p className="mt-2 text-sm text-[var(--color-text-secondary)]">{result.text}</p>}

            {result.state === "success" && result.reservation && (
              <div className="mt-5 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-2)] p-4 text-left text-sm">
                <p><span className="text-[var(--color-text-secondary)]">Joueur</span><span className="float-right font-semibold">{result.reservation.joueur_nom || "-"}</span></p>
                <p className="mt-2"><span className="text-[var(--color-text-secondary)]">Terrain</span><span className="float-right font-semibold">{result.reservation.terrain_nom || "-"}</span></p>
                <p className="mt-2"><span className="text-[var(--color-text-secondary)]">Match</span><span className="float-right font-semibold">{formatDate(result.reservation.date)} {formatTime(result.reservation.heure_debut)}</span></p>
                <p className="mt-2"><span className="text-[var(--color-text-secondary)]">Code</span><span className="float-right font-semibold">{result.reservation.code_reservation || "-"}</span></p>
              </div>
            )}

            <Button type="button" variant={result.state === "invalid" ? "outline" : "hero"} className="mt-6 w-full" onClick={reset}>
              {result.state === "success" ? "Scanner un autre QR" : result.state === "invalid" ? "Réessayer" : "OK"}
            </Button>
          </section>
        </div>
      )}
    </main>
  );
}
