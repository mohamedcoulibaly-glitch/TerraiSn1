import { Navigate } from "react-router-dom";

/** Ancienne route portefeuille → module Finances (Mes gains) */
export default function Portefeuille() {
  return <Navigate to="/backoffice/gerant/finances" replace />;
}
