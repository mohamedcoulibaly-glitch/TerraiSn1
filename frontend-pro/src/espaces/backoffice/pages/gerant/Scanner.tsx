import { Navigate } from "react-router-dom";

/** Scanner libre déprécié (CDC v2.1) — le scan se fait depuis la fiche réservation. */
export default function ScannerGerant() {
  return <Navigate to="/backoffice/gerant" replace />;
}
