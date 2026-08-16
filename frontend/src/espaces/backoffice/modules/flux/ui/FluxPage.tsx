import { useState } from "react";
import { localYmd } from "@/lib/localDate";
import ScannerModal from "@/espaces/backoffice/components/ScannerModal";
import { useFluxToday, usePatchFluxStage } from "../api/fluxQueries";
import type { FluxReservation } from "../types";
import KanbanBoard from "./KanbanBoard";
import FluxMobile from "./FluxMobile";
import LierJoueurModal from "../../crm/ui/LierJoueurModal";

export default function FluxPage() {
  const date = localYmd();
  const { data, isLoading, refetch } = useFluxToday(date);
  const patchStage = usePatchFluxStage(date);
  const [scanCard, setScanCard] = useState<FluxReservation | null>(null);
  const [linkCard, setLinkCard] = useState<FluxReservation | null>(null);

  const cards = data?.reservations || [];
  const dateLabel = new Date(`${date}T00:00:00`).toLocaleDateString("fr-FR", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });

  return (
    <div className="md:space-y-4 md:max-w-[1400px] md:mx-auto">
      <div className="hidden md:block">
        <h1 className="text-xl font-semibold text-[var(--color-text-primary)]" style={{ fontFamily: "var(--font-display)" }}>
          Flux du jour
        </h1>
        <p className="text-sm text-[var(--color-text-secondary)] mt-1">
          {data?.terrain_nom || "Terrain"} · {cards.length} carte{cards.length > 1 ? "s" : ""} · {dateLabel}
        </p>
      </div>

      <div className="md:hidden px-4 pt-3 pb-1">
        <div className="flex items-end justify-between gap-3">
          <div>
            <h1 className="text-[20px] font-semibold leading-tight" style={{ fontFamily: "var(--font-display)" }}>
              Flux du jour
            </h1>
            <p className="text-[13px] text-[var(--color-text-secondary)] mt-0.5 capitalize">{dateLabel}</p>
          </div>
          <span className="text-[13px] font-semibold tabular-nums text-[var(--color-primary)]">{cards.length}</span>
        </div>
      </div>

      {isLoading ? (
        <div className="px-3 md:px-0 space-y-2 md:grid md:grid-cols-4 md:gap-3 md:space-y-0 animate-pulse">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-28 md:h-64 rounded-[16px] bg-[var(--color-surface-2)]" />
          ))}
        </div>
      ) : (
        <>
          <div className="md:hidden">
            <FluxMobile
              cards={cards}
              advancingId={patchStage.isPending ? Number(patchStage.variables?.id) : undefined}
              onMove={(id, stage, extra) =>
                patchStage.mutateAsync({
                  id,
                  stage,
                  waiverEncaissement: extra?.waiverEncaissement,
                  encaisserRestant: extra?.encaisserRestant,
                })
              }
              onScan={setScanCard}
              onLink={setLinkCard}
            />
          </div>
          <div className="hidden md:block">
            <KanbanBoard
              cards={cards}
              onMove={(id, stage, extra) =>
                patchStage.mutateAsync({
                  id,
                  stage,
                  waiverEncaissement: extra?.waiverEncaissement,
                  encaisserRestant: extra?.encaisserRestant,
                })
              }
              onScan={setScanCard}
              onLink={setLinkCard}
            />
          </div>
        </>
      )}

      {scanCard && (
        <ScannerModal
          open
          expectedReservationId={scanCard.id}
          expectedCodeReservation={scanCard.code_reservation}
          onClose={() => setScanCard(null)}
          onSuccess={() => {
            setScanCard(null);
            void refetch();
          }}
        />
      )}

      {linkCard && (
        <LierJoueurModal
          open
          reservationId={linkCard.id}
          defaultName={linkCard.joueur_nom}
          defaultPhone={linkCard.joueur_telephone}
          onClose={() => setLinkCard(null)}
          onLinked={() => void refetch()}
        />
      )}
    </div>
  );
}
