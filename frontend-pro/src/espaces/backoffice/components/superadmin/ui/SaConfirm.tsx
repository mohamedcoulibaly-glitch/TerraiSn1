import SaModal from "./SaModal";
import SaButton from "./SaButton";

export type SaConfirmProps = {
  ouvert: boolean;
  titre: string;
  texte: string;
  labelConfirmer?: string;
  onAnnuler: () => void;
  onConfirmer: () => void;
  variante?: "danger" | "primary";
};

export function SaConfirm({ ouvert, titre, texte, labelConfirmer = "Confirmer", onAnnuler, onConfirmer, variante = "danger" }: SaConfirmProps) {
  return (
    <SaModal
      ouvert={ouvert}
      titre={titre}
      onFermer={onAnnuler}
      footer={
        <>
          <SaButton variant="secondary" onClick={onAnnuler}>Annuler</SaButton>
          <SaButton variant={variante === "danger" ? "danger" : "primary"} onClick={onConfirmer}>{labelConfirmer}</SaButton>
        </>
      }
    >
      <p className="text-[13px]" style={{ color: "var(--sa-text-3)" }}>{texte}</p>
    </SaModal>
  );
}

export default SaConfirm;
