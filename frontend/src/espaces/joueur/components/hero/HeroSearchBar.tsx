import { Search, SlidersHorizontal } from "lucide-react";

type HeroSearchBarProps = {
  searchQuery?: string;
  onSearchChange?: (value: string) => void;
  onFilterClick?: () => void;
  activeFilterCount?: number;
  inputId?: string;
  className?: string;
};

export default function HeroSearchBar({
  searchQuery = "",
  onSearchChange,
  onFilterClick,
  activeFilterCount = 0,
  inputId = "search-terrain",
  className = "",
}: HeroSearchBarProps) {
  return (
    <div
      className={`flex h-12 items-center gap-2 rounded-2xl border border-black/5 bg-white ${className}`}
      style={{
        boxShadow:
          "0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.05)",
      }}
    >
      <Search className="ml-3.5 h-[18px] w-[18px] shrink-0 text-slate-500" aria-hidden="true" />
      <input
        type="text"
        placeholder="Quartier, terrain, nom..."
        value={searchQuery}
        onChange={(e) => onSearchChange?.(e.target.value)}
        className="min-w-0 flex-1 bg-transparent px-1 py-0 text-sm text-slate-900 placeholder:text-slate-500 focus:outline-none"
        id={inputId}
        aria-label="Rechercher un quartier, un terrain ou un nom"
      />
      <button
        type="button"
        onClick={onFilterClick}
        className="relative mr-1.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500 text-white shadow-[0_4px_14px_rgba(16,185,129,0.35)] transition-transform active:scale-95"
        aria-label="Filtres"
      >
        <SlidersHorizontal className="h-[18px] w-[18px]" strokeWidth={2.25} />
        {activeFilterCount > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full border border-emerald-100 bg-white text-[10px] font-bold text-emerald-600">
            {activeFilterCount}
          </span>
        )}
      </button>
    </div>
  );
}
