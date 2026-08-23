import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { gerantApi } from "@/lib/api";
import { LucideByName } from "@/lib/lucideByName";
import { getCommoditeIconName } from "@/constants/commoditesIcons";
import CommoditesSection from "@/components/CommoditesSection";
import { GSwitch } from "@/espaces/backoffice/components/GSwitch";
import { cn } from "@/lib/utils";

export type GerantCommodite = {
  id: number;
  cle: string;
  label_fr: string;
  icone: string;
  associee?: boolean;
  force_par_admin?: number;
  modifiable_gerant?: number;
};

const GROUPS = [
  {
    title: "Confort & Services",
    keys: new Set([
      "vestiaires",
      "douches",
      "parking",
      "wifi",
      "toilettes",
      "priere",
      "espace_priere",
    ]),
  },
  {
    title: "Jeu & Matériel",
    keys: new Set(["eclairage", "ballon", "dossards", "arbitre"]),
  },
  {
    title: "Restauration & Sécurité",
    keys: new Set([
      "buvette",
      "eau",
      "glacons",
      "glaciere",
      "securite",
      "pharmacie",
      "secours",
    ]),
  },
] as const;

function normalizedKey(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

export default function GerantCommoditesSection() {
  const [items, setItems] = useState<GerantCommodite[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [preview, setPreview] = useState(false);

  useEffect(() => {
    gerantApi
      .terrainCommodites()
      .then((list: GerantCommodite[]) => {
        const rows = Array.isArray(list) ? list : [];
        setItems(rows);
        setSelected(new Set(rows.filter((item) => item.associee).map((item) => Number(item.id))));
      })
      .catch(() => toast.error("Impossible de charger les équipements"))
      .finally(() => setLoading(false));
  }, []);

  const previewItems = useMemo(
    () =>
      items
        .filter((item) => selected.has(Number(item.id)))
        .map((item) => ({ cle: item.cle, label_fr: item.label_fr, icone: item.icone })),
    [items, selected],
  );

  const groupedItems = useMemo(() => {
    const assigned = new Set<number>();
    const groups = GROUPS.map((group) => {
      const groupItems = items.filter((item) => {
        const matches = group.keys.has(normalizedKey(item.cle));
        if (matches) assigned.add(Number(item.id));
        return matches;
      });
      return { title: group.title, items: groupItems };
    });
    const others = items.filter((item) => !assigned.has(Number(item.id)));
    return others.length ? [...groups, { title: "Autres", items: others }] : groups;
  }, [items]);

  function toggle(item: GerantCommodite) {
    if (Number(item.force_par_admin) === 1 || Number(item.modifiable_gerant) === 0) return;
    setSelected((prev) => {
      const next = new Set(prev);
      const id = Number(item.id);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function save() {
    setSaving(true);
    try {
      const list = (await gerantApi.patchTerrainCommodites([...selected])) as GerantCommodite[];
      setItems(list);
      setSelected(new Set(list.filter((item) => item.associee).map((item) => Number(item.id))));
      toast.success("Enregistré avec succès !");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Enregistrement impossible");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div
        className="h-40 rounded-2xl animate-pulse"
        style={{ background: "var(--g-surface-2)" }}
      />
    );
  }

  return (
    <section
      className="rounded-2xl p-4 space-y-6"
      style={{ background: "var(--g-surface)", boxShadow: "var(--g-shadow)" }}
    >
      <div>
        <h2 className="text-base font-semibold" style={{ color: "var(--g-text)" }}>
          Ce que tu proposes aux joueurs
        </h2>
        <p className="text-sm mt-1" style={{ color: "var(--g-muted)" }}>
          Active simplement les équipements disponibles sur ton terrain.
        </p>
      </div>

      {groupedItems.map((group) =>
        group.items.length ? (
          <div key={group.title} className="space-y-3">
            <h3 className="text-base font-semibold" style={{ color: "var(--g-text)" }}>
              {group.title}
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {group.items.map((item) => {
                const active = selected.has(Number(item.id));
                const forced = Number(item.force_par_admin) === 1;
                const locked = Number(item.modifiable_gerant) === 0;
                const disabled = forced || locked;
                return (
                  <div
                    key={item.id}
                    role="checkbox"
                    aria-checked={active}
                    aria-disabled={disabled}
                    tabIndex={disabled ? -1 : 0}
                    onClick={() => toggle(item)}
                    onKeyDown={(event) => {
                      if (!disabled && (event.key === "Enter" || event.key === " ")) {
                        event.preventDefault();
                        toggle(item);
                      }
                    }}
                    className={cn(
                      "min-h-[88px] rounded-2xl p-3 flex items-center gap-3 transition-colors",
                      disabled ? "cursor-not-allowed opacity-70" : "cursor-pointer active:scale-[0.99]",
                    )}
                    style={{
                      background: active
                        ? "color-mix(in srgb, var(--g-primary) 14%, var(--g-surface))"
                        : "var(--g-surface-2)",
                      border: `1px solid ${active ? "var(--g-primary)" : "var(--g-border)"}`,
                    }}
                  >
                    <span
                      className="w-12 h-12 shrink-0 rounded-xl inline-flex items-center justify-center"
                      style={{
                        background: active ? "var(--g-primary)" : "var(--g-surface)",
                        color: active ? "white" : "var(--g-muted)",
                      }}
                    >
                      <LucideByName
                        name={getCommoditeIconName(item.cle, item.icone)}
                        size={24}
                      />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-base font-semibold leading-tight" style={{ color: "var(--g-text)" }}>
                        {item.label_fr}
                      </p>
                      {forced ? (
                        <p className="text-xs mt-1" style={{ color: "var(--g-primary)" }}>
                          Activé par l’administration
                        </p>
                      ) : locked ? (
                        <p className="text-xs mt-1" style={{ color: "var(--g-muted)" }}>
                          Géré par l’administration
                        </p>
                      ) : null}
                    </div>
                    <div onClick={(event) => event.stopPropagation()}>
                      <GSwitch
                        checked={active}
                        onChange={() => toggle(item)}
                        label={`${item.label_fr} ${active ? "activé" : "désactivé"}`}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null,
      )}

      <button
        type="button"
        disabled={saving}
        onClick={save}
        className="w-full min-h-[52px] rounded-xl text-base font-semibold text-white disabled:opacity-60 inline-flex items-center justify-center gap-2"
        style={{ background: "var(--g-primary)" }}
      >
        {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : null}
        {saving ? "Enregistrement…" : "Enregistrer les équipements"}
      </button>
      <button
        type="button"
        onClick={() => setPreview((value) => !value)}
        className="w-full min-h-[48px] rounded-xl text-base font-semibold"
        style={{ color: "var(--g-primary)", background: "var(--g-surface-2)" }}
      >
        {preview ? "Masquer l’aperçu joueur" : "Voir l’aperçu joueur"}
      </button>
      {preview ? <CommoditesSection commodites={previewItems} compact /> : null}
    </section>
  );
}
