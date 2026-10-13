import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { formatTelAffichage, masquerNumero } from "@/lib/saContrat";

type Props = {
  numero: string;
  masque?: boolean;
};

export default function NumeroCopier({ numero, masque = false }: Props) {
  const [copied, setCopied] = useState(false);
  const digits = String(numero || "").replace(/\D/g, "");
  if (!digits) return <span className="text-[12px]" style={{ color: "var(--sa-muted)" }}>—</span>;

  const label = masque ? masquerNumero(numero) : formatTelAffichage(numero);

  async function copy() {
    try {
      await navigator.clipboard.writeText(digits);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="text-[12px] font-medium tabular-nums" style={{ color: "var(--sa-text)" }}>
        {label}
      </span>
      <button
        type="button"
        onClick={copy}
        className="inline-flex items-center justify-center w-7 h-7 rounded-md"
        style={{ color: copied ? "var(--sa-success)" : "var(--sa-muted)" }}
        aria-label="Copier le numéro"
      >
        {copied ? <Check size={14} /> : <Copy size={14} />}
      </button>
      {copied ? (
        <span className="text-[10px] font-semibold" style={{ color: "var(--sa-success)" }}>
          Copié !
        </span>
      ) : null}
    </span>
  );
}
