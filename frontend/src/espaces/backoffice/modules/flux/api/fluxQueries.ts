import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { gerantApi } from "@/lib/api";
import type { OperationalStage } from "@/lib/kanbanRules";
import type { FluxTodayPayload } from "../types";

export const fluxKey = (date?: string) => ["gerant", "flux", date || "today"] as const;

export function useFluxToday(date?: string) {
  return useQuery({
    queryKey: fluxKey(date),
    queryFn: async () => (await gerantApi.reservationsToday(date)) as FluxTodayPayload,
    refetchInterval: 8000,
    staleTime: 4000,
  });
}

export function usePatchFluxStage(date?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (vars: {
      id: number;
      stage: OperationalStage;
      waiverEncaissement?: boolean;
      encaisserRestant?: boolean;
    }) =>
      gerantApi.patchReservationStage(vars.id, {
        stage: vars.stage,
        waiverEncaissement: vars.waiverEncaissement,
        encaisserRestant: vars.encaisserRestant,
      }),
    onMutate: async (vars) => {
      await queryClient.cancelQueries({ queryKey: fluxKey(date) });
      const previous = queryClient.getQueryData<FluxTodayPayload>(fluxKey(date));
      if (previous) {
        queryClient.setQueryData<FluxTodayPayload>(fluxKey(date), {
          ...previous,
          reservations: previous.reservations.map((card) =>
            card.id === vars.id
              ? {
                  ...card,
                  operational_stage: vars.stage,
                  checked_in_at: vars.stage === "checkin" ? card.checked_in_at || new Date().toISOString() : card.checked_in_at,
                  montant_restant: vars.stage === "closed" && vars.encaisserRestant ? 0 : card.montant_restant,
                  statut: vars.stage === "closed" ? "match_joue" : card.statut,
                }
              : card,
          ),
        });
      }
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(fluxKey(date), ctx.previous);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: fluxKey(date) });
    },
  });
}
