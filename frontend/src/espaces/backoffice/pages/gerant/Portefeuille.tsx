import { Navigate } from "react-router-dom";

/** Ancienne route portefeuille → module Finances */
export default function Portefeuille() {
  return <Navigate to="/backoffice/gerant/finances" replace />;
}
