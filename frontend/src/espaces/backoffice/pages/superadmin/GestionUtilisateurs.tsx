import { Link } from "react-router-dom";
import { Building2, Shield, UserCog } from "lucide-react";
import { useSaCrumbs } from "@/espaces/backoffice/layout/SuperadminLayout";
import SaPageHeader from "@/espaces/backoffice/components/superadmin/ui/SaPageHeader";

const CARDS = [
  {
    to: "/backoffice/superadmin/gerants",
    title: "Gérants",
    desc: "Rattacher plusieurs gérants à un terrain, principal et planning de garde.",
    icon: UserCog,
  },
  {
    to: "/backoffice/superadmin/proprietaires",
    title: "Propriétaires",
    desc: "Créer et gérer les comptes propriétaires du SaaS.",
    icon: Building2,
  },
  {
    to: "/backoffice/superadmin/superadmins",
    title: "Superadmins",
    desc: "Inviter d'autres superviseurs pour administrer la plateforme.",
    icon: Shield,
  },
] as const;

export default function GestionUtilisateurs() {
  useSaCrumbs([{ label: "Utilisateurs", to: "/backoffice/superadmin/utilisateurs" }]);

  return (
    <div className="space-y-5 max-w-4xl">
      <SaPageHeader
        titre="Utilisateurs"
        sousTitre="Gère les comptes qui font tourner TerrainSN : gérants, propriétaires et superadmins"
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {CARDS.map((card) => (
          <Link
            key={card.to}
            to={card.to}
            className="rounded-xl p-5 block transition-opacity hover:opacity-95"
            style={{ background: "var(--sa-surface)", boxShadow: "var(--sa-shadow)", border: "1px solid var(--sa-border)" }}
          >
            <div
              className="w-10 h-10 rounded-full inline-flex items-center justify-center mb-3"
              style={{ background: "var(--sa-surface-2)", color: "var(--sa-primary)" }}
            >
              <card.icon size={18} />
            </div>
            <p className="text-[15px] font-semibold" style={{ color: "var(--sa-text)" }}>
              {card.title}
            </p>
            <p className="text-[12px] mt-1.5" style={{ color: "var(--sa-muted)" }}>
              {card.desc}
            </p>
            <p className="text-[12px] font-semibold mt-3" style={{ color: "var(--sa-primary)" }}>
              Ouvrir →
            </p>
          </Link>
        ))}
      </div>
    </div>
  );
}
