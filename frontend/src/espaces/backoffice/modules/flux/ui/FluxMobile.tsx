import { useMemo, useState } from "react";
import { QrCode, Phone, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { assertStageTransition, nextKanbanStage, type OperationalStage } from "@/lib/kanbanRules";
import {
  FLUX_MOBILE_TABS,
  delayTone,
  formatFcfa,
  groupFluxCards,
  hotColumn,
  initials,
  type FluxReservation,
} from "../types";
import FluxCardSheet from "./FluxCardSheet";

type Props = {
  cards: FluxReservation[];
  advancingId?: number;
  onMove: (id: number, stage: OperationalStage, extra?: { waiverEncaissement?: boolean; encaisserRestant?: boolean }) => Promise<unknown>;
  onScan: (card: FluxReservation) => void;
  onLink: (card: FluxReservation) => void;
};

export default function FluxMobile({ cards, advancingId, onMove, onScan, onLink }: Props) {
  const grouped = groupFluxCards(cards);
  const suggested = hotColumn(cards);
  const [tab, setTab] = useState<OperationalStage | null>(null);
  const [open, setOpen] = useState<FluxReservation | null>(null);
  const activeTab = tab ?? suggested;

  const counts = useMemo(
    () => ({
      reserved: grouped.reserved.length,
      checkin: grouped.checkin.length,
      match: grouped.match.length,
      checkout: grouped.checkout.length + grouped.closed.length,
    }),
    [grouped],
  );

  const list = activeTab === "checkout" ? [...grouped.checkout, ...grouped.closed] : grouped[activeTab];

  const advance = async (
    card: FluxReservation,
    to: OperationalStage,
    extra?: { waiverEncaissement?: boolean; encaisserRestant?: boolean },
  ) => {
    try {
      assertStageTransition(
        {
          stage: card.operational_stage,
          statut: card.statut,
          date: card.date,
          heure_debut: card.heure_debut,
          heure_fin: card.heure_fin,
          fenetre_retard: card.fenetre_retard,
          checked_in_at: card.checked_in_at || null,
          montant_restant: Number(card.montant_restant || 0),
          waiverEncaissement: Boolean(extra?.waiverEncaissement || extra?.encaisserRestant),
          crm: card.crm || { bloqueReservation: false },
        },
        to,
      );
      await onMove(card.id, to, extra);
      setOpen(null);
      if (to !== "closed") setTab(to === "checkout" ? "checkout" : to);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Action impossible");
    }
  };

  return (
    <div className="flex flex-col min-h-0">
      <div className="sticky top-0 z-20 bg-[var(--color-bg)] pt-3 px-3 pb-2">
        <div className="grid grid-cols-4 gap-1 p-1 rounded-[14px] bg-white border border-[var(--color-border)]">
          {FLUX_MOBILE_TABS.map((t) => {
            const active = activeTab === t.id;
            const n = counts[t.id as keyof typeof counts];
            const urgent = suggested === t.id && n > 0;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`relative min-h-[52px] rounded-[10px] px-1 py-1.5 ${
                  active ? "bg-[var(--color-primary)] text-white" : "text-[var(--color-text-secondary)]"
                }`}
              >
                <span className="block text-[15px] font-semibold leading-none tabular-nums">{n}</span>
                <span className="block text-[11px] mt-1 font-medium leading-none">{t.short}</span>
                {urgent && !active && (
                  <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-[var(--color-accent)]" />
                )}
              </button>
            );
          })}
        </div>
      </div>

      <ul className="px-3 pb-4 space-y-2.5">
        {list.length === 0 && (
          <li className="rounded-[16px] bg-white border border-[var(--color-border)] px-4 py-10 text-center">
            <p className="text-[15px] font-medium">Rien ici pour le moment</p>
            <p className="text-sm text-[var(--color-text-muted)] mt-1">Passe à un autre onglet ou attends la prochaine arrivée.</p>
          </li>
        )}
        {list.map((card) => {
          const tone = delayTone(card);
          const next = nextKanbanStage(card.operational_stage);
          const blocked = Boolean(card.crm?.bloqueReservation);
          const restant = Number(card.montant_restant || 0);
          const showScan = card.operational_stage === "checkin" || (card.operational_stage === "reserved" && card.dans_fenetre_checkin);
          return (
            <li key={card.id}>
              <article
                className={`rounded-[16px] bg-white border p-3.5 ${
                  tone === "late"
                    ? "border-l-[4px] border-l-[var(--color-warning)] border-[var(--color-border)]"
                    : tone === "expired"
                      ? "border-l-[4px] border-l-[var(--color-danger)] border-[var(--color-border)]"
                      : "border-[var(--color-border)]"
                }`}
              >
                <button type="button" className="w-full text-left flex items-start gap-3" onClick={() => setOpen(card)}>
                  <span className="w-11 h-11 rounded-full bg-[var(--color-surface-2)] text-[13px] font-semibold flex items-center justify-center shrink-0">
                    {initials(card.joueur_nom)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="text-[18px] font-semibold tabular-nums" style={{ fontFamily: "var(--font-display)" }}>
                        {String(card.heure_debut).slice(0, 5)}
                        <span className="text-[var(--color-text-muted)] font-medium text-[14px]"> – {String(card.heure_fin).slice(0, 5)}</span>
                      </p>
                      <ChevronRight className="w-4 h-4 text-[var(--color-text-muted)] shrink-0" />
                    </div>
                    <p className="text-[15px] font-medium truncate mt-0.5">{card.joueur_nom || "Walk-in"}</p>
                    <p className="text-[12px] text-[var(--color-text-muted)] mt-0.5 truncate">
                      {card.code_reservation || `#${card.id}`}
                      {restant > 0 ? ` · ${formatFcfa(restant)}` : ""}
                    </p>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {blocked && (
                        <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-[color-mix(in_srgb,var(--color-danger)_12%,white)] text-[var(--color-danger)]">
                          {card.crm?.reason || "Bloqué"}
                        </span>
                      )}
                      {tone === "late" && (
                        <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-[color-mix(in_srgb,var(--color-warning)_14%,white)] text-[var(--color-warning)]">
                          Retard
                        </span>
                      )}
                      {!card.joueur_id && (
                        <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-[var(--color-surface-2)]">Walk-in</span>
                      )}
                    </div>
                  </div>
                </button>

                <div className="mt-3 flex gap-2">
                  {showScan && (
                    <button
                      type="button"
                      onClick={() => onScan(card)}
                      className="flex-1 min-h-[44px] rounded-[12px] bg-[var(--color-primary)] text-white text-[13px] font-semibold inline-flex items-center justify-center gap-1.5"
                    >
                      <QrCode className="w-4 h-4" /> Scanner
                    </button>
                  )}
                  {next && !blocked && !(next === "closed" && restant > 0) && (
                    <button
                      type="button"
                      disabled={advancingId === card.id}
                      onClick={() =>
                        void advance(
                          card,
                          next,
                          next === "closed" ? { encaisserRestant: false } : undefined,
                        )
                      }
                      className={`flex-1 min-h-[44px] rounded-[12px] text-[13px] font-semibold disabled:opacity-50 ${
                        showScan
                          ? "border border-[var(--color-border)] bg-white"
                          : "bg-[var(--color-primary)] text-white"
                      }`}
                    >
                      {next === "checkin" ? "Arrivée" : next === "match" ? "Match" : next === "checkout" ? "Terminer" : "Clôturer"}
                    </button>
                  )}
                  {next === "closed" && restant > 0 && !blocked && (
                    <button
                      type="button"
                      disabled={advancingId === card.id}
                      onClick={() => setOpen(card)}
                      className="flex-1 min-h-[44px] rounded-[12px] bg-[var(--color-primary)] text-white text-[13px] font-semibold disabled:opacity-50"
                    >
                      Encaisser
                    </button>
                  )}
                  {card.joueur_telephone && (
                    <a
                      href={`tel:${card.joueur_telephone}`}
                      className="min-h-[44px] min-w-[44px] rounded-[12px] border border-[var(--color-border)] inline-flex items-center justify-center"
                      aria-label="Appeler"
                    >
                      <Phone className="w-4 h-4" />
                    </a>
                  )}
                </div>
              </article>
            </li>
          );
        })}
      </ul>

      {open && (
        <FluxCardSheet
          card={open}
          advancing={advancingId === open.id}
          onClose={() => setOpen(null)}
          onScan={() => {
            onScan(open);
            setOpen(null);
          }}
          onLink={() => {
            onLink(open);
            setOpen(null);
          }}
          onAdvance={(stage, extra) => void advance(open, stage, extra)}
        />
      )}
    </div>
  );
}
