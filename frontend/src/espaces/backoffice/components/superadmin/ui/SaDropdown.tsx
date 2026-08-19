import { useEffect, useRef, useState, type ReactNode } from "react";
import { MoreHorizontal } from "lucide-react";

export type SaDropdownItem = {
  label: string;
  onClick: () => void;
  danger?: boolean;
};

export type SaDropdownProps = {
  items: SaDropdownItem[];
  className?: string;
  trigger?: ReactNode;
};

export function SaDropdown({ items, className, trigger }: SaDropdownProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  return (
    <div ref={ref} className={`relative ${className || ""}`}>
      <button type="button" className="sa-btn sa-btn-ghost sa-btn-sm" onClick={() => setOpen((v) => !v)} aria-label="Actions">
        {trigger || <MoreHorizontal size={16} />}
      </button>
      {open ? (
        <div className="absolute right-0 mt-1 z-20 min-w-[180px] py-1 rounded-[var(--sa-radius-md)]" style={{ background: "var(--sa-surface)", border: "1px solid var(--sa-border)", boxShadow: "var(--sa-shadow-lg)" }}>
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              className="w-full text-left px-3 py-2 text-[13px]"
              style={{ color: item.danger ? "var(--sa-danger)" : "var(--sa-text-2)" }}
              onClick={() => {
                setOpen(false);
                item.onClick();
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default SaDropdown;
