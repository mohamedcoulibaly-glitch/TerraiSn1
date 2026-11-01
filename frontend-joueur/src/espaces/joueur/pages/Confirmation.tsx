import { Navigate, useLocation, useSearchParams } from "react-router-dom";
import { useMemo } from "react";

/**
 * Route legacy `/reservation/confirmation`.
 * Redirige systématiquement vers `/reservation/succes` (polling IPN + états honnêtes).
 */
const ReservationConfirmation = () => {
  const location = useLocation();
  const [searchParams] = useSearchParams();

  const targetId = useMemo(() => {
    const fromQuery = searchParams.get("id");
    if (fromQuery) return fromQuery;
    const stateId = (location.state as { reservationId?: number | string } | null)?.reservationId;
    if (stateId != null) return String(stateId);
    const stored = localStorage.getItem("terrainsn_last_reservation_id");
    return stored || "";
  }, [searchParams, location.state]);

  if (targetId) {
    return <Navigate to={`/reservation/succes?id=${targetId}`} replace />;
  }
  return <Navigate to="/reservations" replace />;
};

export default ReservationConfirmation;
