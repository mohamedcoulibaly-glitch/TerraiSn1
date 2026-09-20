import { WHATSAPP_INFRA_MESSAGE } from "@/lib/whatsappMessages";

type Props = {
  visible?: boolean;
  tone?: "superadmin" | "gerant" | "default";
  message?: string;
};

export default function WhatsAppInfraBanner({ visible, tone = "default", message }: Props) {
  if (!visible) return null;
  const text = message || WHATSAPP_INFRA_MESSAGE;
  const bg = tone === "superadmin" ? "var(--sa-danger)" : "hsl(var(--destructive))";
  return (
    <div
      role="status"
      className="px-4 py-2 text-[12px] font-medium text-white"
      style={{ background: bg }}
    >
      {text}
    </div>
  );
}
