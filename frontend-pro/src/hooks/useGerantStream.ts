import { useEffect, useRef } from "react";
import { authApi } from "@/lib/api";

const API_URL = import.meta.env.VITE_API_URL || "/api";

export type GerantStreamEvent = {
  terrain_id?: number;
  reservation_id?: number;
  creneau_id?: number | null;
  statut?: string;
  code?: string | null;
  joueur_prenom?: string | null;
  joueur_telephone?: string | null;
  heure_debut?: string | null;
  heure_fin?: string | null;
  montant_restant?: number | null;
  [key: string]: unknown;
};

export type GerantStreamCallbacks = {
  onReservationConfirmee?: (data: GerantStreamEvent) => void;
  onCreneauLibere?: (data: GerantStreamEvent) => void;
  onReservationCreee?: (data: GerantStreamEvent) => void;
  onCreneauVerrouille?: (data: GerantStreamEvent) => void;
  onMatchValide?: (data: GerantStreamEvent) => void;
  onReservationAnnulee?: (data: GerantStreamEvent) => void;
};

/**
 * Temps réel gérant via SSE authentifié (`GET /api/gerant/stream`).
 *
 * EventSource ne sait pas envoyer le header Authorization : le JWT passe
 * en query `?token=`. Le serveur connaît les terrains du gérant (JWT +
 * affectations), l'abonnement se fait donc sans terrain_id côté client.
 * Reconnexion automatique d'EventSource en cas de coupure.
 */
export function useGerantStream(enabled: boolean, callbacks: GerantStreamCallbacks) {
  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;

  useEffect(() => {
    if (!enabled) return;
    const token = authApi.getToken();
    if (!token) return;

    const es = new EventSource(`${API_URL}/gerant/stream?token=${encodeURIComponent(token)}`);

    const bind = (type: string, fn?: (data: GerantStreamEvent) => void) => {
      es.addEventListener(type, (e) => {
        try {
          fn?.(JSON.parse((e as MessageEvent).data) as GerantStreamEvent);
        } catch {
          /* payload malformé ignoré */
        }
      });
    };

    bind("reservation_confirmee", (d) => callbacksRef.current.onReservationConfirmee?.(d));
    bind("creneau_libere", (d) => callbacksRef.current.onCreneauLibere?.(d));
    bind("reservation_creee", (d) => callbacksRef.current.onReservationCreee?.(d));
    bind("creneau_verrouille", (d) => callbacksRef.current.onCreneauVerrouille?.(d));
    bind("match_valide", (d) => callbacksRef.current.onMatchValide?.(d));
    bind("reservation_annulee", (d) => callbacksRef.current.onReservationAnnulee?.(d));

    es.onerror = () => {
      // EventSource se reconnecte automatiquement — rien à faire
      console.warn("[SSE] Connexion gérant interrompue — reconnexion automatique");
    };

    return () => es.close();
  }, [enabled]);
}
