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
      className={`bg-white rounded-2xl flex items-center gap-2 border border-black/5 ${className}`}
      style={{
        boxShadow:
          "0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.05)",
      }}
    >
      <Search className="w-4 h-4 text-slate-400 ml-4 shrink-0" aria-hidden="true" />
      <input
        type="text"
        placeholder="Quartier, terrain, nom..."
        value={searchQuery}
        onChange={(e) => onSearchChange?.(e.target.value)}
        className="flex-1 bg-transparent text-sm text-slate-900 placeholder:text-slate-400 py-3 px-1 focus:outline-none min-w-0"
        id={inputId}
      />
      <button
        type="button"
        onClick={onFilterClick}
        className="relative mr-2 p-2.5 rounded-xl bg-emerald-500 text-white font-bold active:scale-95 transition-transform shrink-0 flex items-center justify-center shadow-[0_4px_14px_rgba(16,185,129,0.35)]"
        aria-label="Filtres"
      >
        <SlidersHorizontal className="w-4 h-4" />
        {activeFilterCount > 0 && (
          <span className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-white text-emerald-600 text-[10px] font-bold flex items-center justify-center border border-emerald-100">
            {activeFilterCount}
          </span>
        )}
      </button>
    </div>
  );
}
