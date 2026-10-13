import { forceMotDePasse } from "@/auth/loginErrors";

export default function IndicateurForceMdp({
  password,
  theme,
}: {
  password: string;
  theme: "joueur" | "backoffice";
}) {
  const level = forceMotDePasse(password);
  if (level === "empty") return null;
  const error = theme === "joueur" ? "var(--lj-error)" : "var(--lb-error)";
  const primary = theme === "joueur" ? "var(--lj-primary)" : "var(--lb-primary)";
  const color = level === "weak" ? error : level === "strong" ? primary : "var(--warning)";
  const width = level === "weak" ? "33%" : level === "medium" ? "66%" : "100%";

  return (
    <div className="mt-2 h-1 rounded-full overflow-hidden" style={{ background: "var(--surface-2)" }}>
      <div className="h-full rounded-full transition-all duration-200" style={{ width, background: color }} />
    </div>
  );
}
