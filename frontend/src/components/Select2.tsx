import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Search } from "lucide-react";
import { cn } from "@/lib/utils";

export type Select2Option = {
  value: string;
  label: string;
  disabled?: boolean;
};

type Props = {
  value: string;
  onChange: (value: string) => void;
  options: Select2Option[];
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  searchable?: boolean;
  className?: string;
  style?: React.CSSProperties;
  size?: "sm" | "md";
};

export default function Select2({
  value,
  onChange,
  options,
  placeholder = "Sélectionner",
  disabled,
  required,
  searchable,
  className = "",
  style,
  size = "md",
}: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const menuId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [menu, setMenu] = useState<{ top: number; left: number; width: number; up: boolean } | null>(null);

  const showSearch = searchable ?? options.length >= 6;
  const selected = options.find((o) => o.value === value);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q));
  }, [options, query]);

  function place() {
    const el = rootRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const up = window.innerHeight - r.bottom < 260 && r.top > 260;
    setMenu({
      top: up ? r.top : r.bottom + 4,
      left: r.left,
      width: Math.max(r.width, 160),
      up,
    });
  }

  function close() {
    setOpen(false);
    setQuery("");
  }

  function pick(opt: Select2Option) {
    if (opt.disabled) return;
    onChange(opt.value);
    close();
  }

  useEffect(() => {
    if (!open) return;
    place();
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (rootRef.current?.contains(t)) return;
      if (menuRef.current?.contains(t)) return;
      close();
    };
    const onReposition = () => place();
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("resize", onReposition);
    window.addEventListener("scroll", onReposition, true);
    const t = window.setTimeout(() => searchRef.current?.focus(), 0);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("resize", onReposition);
      window.removeEventListener("scroll", onReposition, true);
      window.clearTimeout(t);
    };
  }, [open]);

  useEffect(() => {
    setActive(0);
  }, [query, open]);

  const height = size === "sm" ? 36 : 44;

  return (
    <div ref={rootRef} className={cn("select2-root w-full", className)} style={style}>
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => {
          if (disabled) return;
          setOpen((v) => !v);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen(true);
          }
        }}
        className="select2-trigger"
        style={{ minHeight: height }}
      >
        <span className={selected ? "select2-value" : "select2-placeholder"}>
          {selected ? selected.label : placeholder}
        </span>
        <ChevronDown size={16} className="select2-chevron" />
      </button>
      {required ? (
        <input
          tabIndex={-1}
          required
          value={value}
          onChange={() => {}}
          className="select2-native"
          aria-hidden
        />
      ) : null}
      {open && menu
        ? createPortal(
            <div
              ref={menuRef}
              id={menuId}
              className="select2-menu"
              style={{
                position: "fixed",
                left: menu.left,
                width: menu.width,
                top: menu.up ? undefined : menu.top,
                bottom: menu.up ? window.innerHeight - menu.top : undefined,
              }}
              role="listbox"
            >
              {showSearch ? (
                <div className="select2-search">
                  <Search size={14} />
                  <input
                    ref={searchRef}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Rechercher…"
                    onKeyDown={(e) => {
                      if (e.key === "Escape") {
                        e.preventDefault();
                        close();
                      } else if (e.key === "ArrowDown") {
                        e.preventDefault();
                        setActive((i) => Math.min(filtered.length - 1, i + 1));
                      } else if (e.key === "ArrowUp") {
                        e.preventDefault();
                        setActive((i) => Math.max(0, i - 1));
                      } else if (e.key === "Enter") {
                        e.preventDefault();
                        const opt = filtered[active];
                        if (opt) pick(opt);
                      }
                    }}
                  />
                </div>
              ) : null}
              <div className="select2-list">
                {filtered.length === 0 ? (
                  <p className="select2-empty">Aucun résultat</p>
                ) : (
                  filtered.map((opt, i) => {
                    const isSel = opt.value === value;
                    return (
                      <button
                        key={`${opt.value}-${i}`}
                        type="button"
                        role="option"
                        aria-selected={isSel}
                        disabled={opt.disabled}
                        className={`select2-option${isSel ? " is-selected" : ""}${i === active ? " is-active" : ""}`}
                        onMouseEnter={() => setActive(i)}
                        onClick={() => pick(opt)}
                      >
                        <span>{opt.label}</span>
                        {isSel ? <Check size={14} /> : null}
                      </button>
                    );
                  })
                )}
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
