export type FormatOption = {
  cle: string;
  label: string;
  prix_heure: number;
  map_grille?: string | null;
};

type SelecteurProps = {
  formats: FormatOption[];
  valeur: string;
  onChange: (cle: string) => void;
  prixPour: (fmt: FormatOption) => number;
};

/**
 * Sélecteur de type de location — affiché UNIQUEMENT quand le terrain
 * propose les deux formats (`types_location === 'les_deux'`).
 * Composant dédié, sans code partagé avec les labels ci-dessous.
 */
export const SelecteurTypeLocation = ({ formats, valeur, onChange, prixPour }: SelecteurProps) => {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)] mb-2">
        2 · Format
      </p>
      <div className="grid grid-cols-2 gap-2">
        {formats.map((fmt) => {
          const price = prixPour(fmt);
          const actif = valeur === fmt.cle;
          return (
            <button
              key={fmt.cle}
              type="button"
              onClick={() => onChange(fmt.cle)}
              className={`rounded-xl p-3 text-left min-h-[64px] border transition-colors ${
                actif
                  ? "bg-[var(--primary)] text-white border-[var(--primary)]"
                  : "bg-white dark:bg-[var(--surface)] border-gray-200 dark:border-[var(--border)]"
              }`}
            >
              <span className="block text-sm font-semibold">{fmt.label}</span>
              <span className="text-[11px] opacity-80">{price.toLocaleString("fr-SN")} FCFA/h</span>
            </button>
          );
        })}
      </div>
    </div>
  );
};

/**
 * Label affiché quand le terrain ne loue QUE le terrain entier
 * (`types_location === 'entier'`) — aucun choix proposé au joueur.
 */
export const LabelTerrainEntier = ({ prixHeure }: { prixHeure: number }) => {
  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--surface)] px-3 py-2.5">
      <p className="text-xs text-[var(--color-text-muted)]">
        Format :{" "}
        <span className="font-semibold text-[var(--color-text-primary)]">Terrain entier uniquement</span>
        {prixHeure > 0 ? (
          <span className="text-[var(--color-text-primary)]">
            {" "}
            — {prixHeure.toLocaleString("fr-SN")} FCFA/h
          </span>
        ) : null}
      </p>
    </div>
  );
};

/**
 * Label affiché quand le terrain ne loue QUE le demi-terrain
 * (`types_location === 'demi_terrain'`) — aucun choix proposé au joueur.
 */
export const LabelDemiTerrain = ({ prixHeure }: { prixHeure: number }) => {
  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--surface)] px-3 py-2.5">
      <p className="text-xs text-[var(--color-text-muted)]">
        Format :{" "}
        <span className="font-semibold text-[var(--color-text-primary)]">Demi-terrain uniquement</span>
        {prixHeure > 0 ? (
          <span className="text-[var(--color-text-primary)]">
            {" "}
            — {prixHeure.toLocaleString("fr-SN")} FCFA/h
          </span>
        ) : null}
      </p>
    </div>
  );
};
