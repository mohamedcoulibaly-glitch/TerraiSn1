import * as LucideIcons from "lucide-react";
import type { LucideProps } from "lucide-react";

const SKIP = new Set(["createLucideIcon", "createElement", "Icon", "default", "icons"]);
const ALIASES: Record<string, string> = { ParkingSquare: "SquareParking" };

export function lucideIcon(name?: string) {
  if (!name || SKIP.has(name)) return LucideIcons.Star;
  const resolved = ALIASES[name] || name;
  const Icon = (LucideIcons as Record<string, unknown>)[resolved];
  if (typeof Icon === "function") return Icon as React.ComponentType<LucideProps>;
  return LucideIcons.Star;
}

export function isLucideName(name: string) {
  if (!name || SKIP.has(name)) return false;
  const resolved = ALIASES[name] || name;
  return typeof (LucideIcons as Record<string, unknown>)[resolved] === "function";
}

export function LucideByName({ name, ...props }: { name?: string } & LucideProps) {
  const Icon = lucideIcon(name);
  return <Icon {...props} />;
}
