import { icons, CircleCheck } from "lucide-react";
import type { LucideProps, LucideIcon } from "lucide-react";

const SKIP = new Set(["createLucideIcon", "createElement", "Icon", "default", "icons"]);
const ALIASES: Record<string, string> = {
  ParkingSquare: "SquareParking",
  // Alias Lucide récents
  CheckCircle2: "CircleCheck",
  HelpCircle: "CircleHelp",
  AlertCircle: "CircleAlert",
};

function resolveName(name?: string): string | undefined {
  if (!name || SKIP.has(name)) return undefined;
  return ALIASES[name] || name;
}

/** Résout un nom Lucide via le dictionnaire `icons` (fiable avec Vite / ESM). */
export function lucideIcon(name?: string): LucideIcon {
  const resolved = resolveName(name);
  if (resolved && icons[resolved as keyof typeof icons]) {
    return icons[resolved as keyof typeof icons];
  }
  // Essayer le nom brut si l’alias n’a rien donné
  if (name && icons[name as keyof typeof icons]) {
    return icons[name as keyof typeof icons];
  }
  return CircleCheck;
}

export function isLucideName(name: string) {
  const resolved = resolveName(name);
  if (resolved && icons[resolved as keyof typeof icons]) return true;
  return Boolean(name && icons[name as keyof typeof icons]);
}

export function LucideByName({ name, ...props }: { name?: string } & LucideProps) {
  const Icon = lucideIcon(name);
  return <Icon {...props} />;
}
