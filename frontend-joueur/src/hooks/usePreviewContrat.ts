import { useMemo } from "react";
import {
  calculerPreviewContrat,
  type FraisPolitique,
  type PreviewContratInput,
} from "@/lib/saContrat";

export type UsePreviewContratArgs = {
  prix?: number;
  pctAvance: number;
  pctCommission: number;
  mode?: "auto" | "retrait";
  politiqueFrais: FraisPolitique;
  pctFraisGerant?: number;
  pctFraisPlateforme?: number;
};

export function usePreviewContrat(args: UsePreviewContratArgs) {
  return useMemo(() => {
    const input: PreviewContratInput = {
      prix: args.prix,
      pctAvance: args.pctAvance,
      pctCommission: args.pctCommission,
      politiqueFrais: args.politiqueFrais,
      pctFraisGerant: args.pctFraisGerant,
      pctFraisPlateforme: args.pctFraisPlateforme,
    };
    return calculerPreviewContrat(input);
  }, [
    args.prix,
    args.pctAvance,
    args.pctCommission,
    args.politiqueFrais,
    args.pctFraisGerant,
    args.pctFraisPlateforme,
  ]);
}
