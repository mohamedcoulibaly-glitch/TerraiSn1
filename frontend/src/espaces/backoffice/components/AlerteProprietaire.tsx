import { AlertTriangle } from "lucide-react";
import { useNavigate } from "react-router-dom";
import type { AlerteProprietaire as Alerte } from "@/hooks/useAlertesProprietaire";

export default function AlerteProprietaire({ alerte }: { alerte: Alerte }) {
  const navigate = useNavigate();
  const danger = alerte.type === "danger";

  return (
    <div
      className="p-fade-in rounded-xl px-3.5 py-3 flex items-center gap-3"
      style={{
        background: danger ? "var(--p-alert-bg)" : "var(--p-attention-bg)",
        border: `1px solid ${danger ? "var(--p-alert-border)" : "var(--p-attention)"}`,
      }}
    >
      <AlertTriangle
        className="w-5 h-5 shrink-0"
        style={{ color: danger ? "var(--p-verifier)" : "var(--p-attention)" }}
      />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-semibold leading-snug" style={{ color: "var(--p-text)" }}>
          {danger ? "⚠️ " : "📉 "}
          {alerte.terrain_nom} — {alerte.message}
        </p>
        {alerte.gerant_prenom && danger && (
          <p className="text-[11px] mt-0.5" style={{ color: "var(--p-muted)" }}>
            Pense à en parler avec {alerte.gerant_prenom} 😊
          </p>
        )}
      </div>
      {alerte.lien && alerte.label_lien && (
        <button
          type="button"
          onClick={() => navigate(alerte.lien!)}
          className="shrink-0 min-h-[44px] px-3 rounded-full text-[11px] font-semibold border"
          style={{
            borderColor: danger ? "var(--p-alert-border)" : "var(--p-attention)",
            color: danger ? "var(--p-verifier)" : "var(--p-attention)",
          }}
        >
          {alerte.label_lien}
        </button>
      )}
    </div>
  );
}
