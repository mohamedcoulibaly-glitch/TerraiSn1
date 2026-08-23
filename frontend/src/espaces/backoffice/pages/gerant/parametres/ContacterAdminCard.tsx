import { MessageCircle } from "lucide-react";

function supportWhatsAppHref(message: string) {
  const raw = String(import.meta.env.VITE_SUPPORT_WHATSAPP || "221770000000").replace(/\D/g, "");
  const phone = raw.startsWith("221") ? raw : raw.length === 9 ? `221${raw}` : raw;
  return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
}

export default function ContacterAdminCard({ hint }: { hint?: string }) {
  return (
    <div
      className="rounded-2xl p-4 space-y-3"
      style={{
        background: "color-mix(in srgb, var(--g-primary) 10%, var(--g-surface))",
        border: "1px solid color-mix(in srgb, var(--g-primary) 28%, transparent)",
      }}
    >
      <div>
        <p className="text-base font-semibold" style={{ color: "var(--g-text)" }}>
          Besoin de modifier ces informations ?
        </p>
        <p className="text-sm mt-1" style={{ color: "var(--g-muted)" }}>
          {hint || "Ces infos sont gérées par l'administration pour éviter les erreurs."}
        </p>
      </div>
      <a
        href={supportWhatsAppHref(
          "Bonjour, je suis gérant et j’ai besoin de modifier des informations sur mon compte / mon terrain.",
        )}
        target="_blank"
        rel="noreferrer"
        className="w-full min-h-[48px] rounded-xl text-base font-semibold text-white inline-flex items-center justify-center gap-2"
        style={{ background: "#16a34a" }}
      >
        <MessageCircle className="w-5 h-5" />
        Contacter l&apos;administration
      </a>
    </div>
  );
}
