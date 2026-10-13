import type { ReactNode } from "react";

export type SaPageHeaderProps = {
  titre: string;
  sousTitre?: string;
  actions?: ReactNode;
  className?: string;
};

export function SaPageHeader({ titre, sousTitre, actions, className }: SaPageHeaderProps) {
  return (
    <div className={`flex flex-col sm:flex-row sm:items-start justify-between gap-3 ${className || ""}`}>
      <div>
        <h1 className="text-[22px] font-semibold" style={{ fontFamily: "var(--sa-font-display)", color: "var(--sa-text)" }}>{titre}</h1>
        {sousTitre ? <p className="text-[13px] mt-1" style={{ color: "var(--sa-text-3)" }}>{sousTitre}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

export default SaPageHeader;
