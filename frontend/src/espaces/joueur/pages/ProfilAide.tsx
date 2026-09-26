import { ArrowLeft, HelpCircle, MessageCircle, Mail, Phone, ChevronDown, ChevronUp, Search } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useMemo, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Textarea } from "@/components/ui/textarea";

const faqItems = [
  {
    question: "Comment réserver un terrain ?",
    answer:
      "Pour réserver un terrain, rendez-vous dans l'onglet Explorer, sélectionnez le terrain de votre choix, choisissez la date et l'horaire souhaités, puis procédez au paiement. Votre réservation sera ensuite confirmée par le gérant.",
  },
  {
    question: "Comment annuler une réservation ?",
    answer:
      "Vous pouvez annuler une réservation depuis l'onglet 'Mes réservations'. Les réservations en attente ou acceptées peuvent être annulées. Veuillez noter que les annulations sont soumises aux conditions du terrain.",
  },
  {
    question: "Quels sont les moyens de paiement acceptés ?",
    answer:
      "Nous acceptons les paiements par Mobile Money (Orange Money, Wave) ainsi que les cartes bancaires selon la passerelle configurée. Le paiement est sécurisé et traité par nos partenaires.",
  },
  {
    question: "Comment contacter le gérant d'un terrain ?",
    answer:
      "Depuis la fiche terrain ou le détail d'une réservation, utilisez les coordonnées / WhatsApp du gérant affichés pour le terrain concerné.",
  },
  {
    question: "Que faire en cas de problème sur place ?",
    answer:
      "En cas de problème, contactez d'abord le gérant du terrain. Si le problème persiste, notre équipe support est disponible via WhatsApp ou e-mail. Conservez toujours votre numéro de réservation.",
  },
  {
    question: "Comment laisser un avis ?",
    answer:
      "Après une réservation effectuée, vous pouvez laisser un avis et une note pour le terrain depuis l'onglet 'Mes réservations'. Vos avis aident la communauté à faire de meilleurs choix.",
  },
];

function digitsPhone(raw: string) {
  return String(raw || "").replace(/\D/g, "");
}

function supportWhatsAppHref(message: string) {
  const raw = digitsPhone(import.meta.env.VITE_SUPPORT_WHATSAPP || "221770000000");
  const phone = raw.startsWith("221") ? raw : raw.length === 9 ? `221${raw}` : raw;
  return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
}

function formatSnDisplay(digits: string) {
  const d = digits.startsWith("221") ? digits.slice(3) : digits;
  if (d.length < 9) return `+${digits}`;
  return `+221 ${d.slice(0, 2)} ${d.slice(2, 5)} ${d.slice(5, 7)} ${d.slice(7, 9)}`;
}

const ProfilAide = () => {
  const navigate = useNavigate();
  const { isAuthenticated, user } = useAuth();
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedFaq, setExpandedFaq] = useState<number | null>(null);
  const [contactForm, setContactForm] = useState({
    subject: "",
    message: "",
  });

  const supportEmail = String(import.meta.env.VITE_SUPPORT_EMAIL || "support@terrainsn.sn").trim();
  const supportPhoneDigits = digitsPhone(import.meta.env.VITE_SUPPORT_PHONE || import.meta.env.VITE_SUPPORT_WHATSAPP || "");
  const supportPhoneDisplay = supportPhoneDigits
    ? formatSnDisplay(supportPhoneDigits.startsWith("221") ? supportPhoneDigits : `221${supportPhoneDigits}`)
    : null;
  const cguUrl = String(import.meta.env.VITE_CGU_URL || "").trim();
  const privacyUrl = String(import.meta.env.VITE_PRIVACY_URL || "").trim();

  const filteredFaq = useMemo(
    () =>
      faqItems.filter(
        (item) =>
          item.question.toLowerCase().includes(searchQuery.toLowerCase()) ||
          item.answer.toLowerCase().includes(searchQuery.toLowerCase()),
      ),
    [searchQuery],
  );

  const openLegal = (kind: "cgu" | "privacy") => {
    const url = kind === "cgu" ? cguUrl : privacyUrl;
    if (url) {
      window.open(url, "_blank", "noopener,noreferrer");
      return;
    }
    const label = kind === "cgu" ? "conditions d'utilisation" : "politique de confidentialité";
    window.open(
      supportWhatsAppHref(`Bonjour, je souhaite consulter les ${label} de TerrainSN.`),
      "_blank",
      "noopener,noreferrer",
    );
  };

  const handleContactSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!contactForm.subject.trim() || !contactForm.message.trim()) {
      toast.error("Veuillez remplir tous les champs");
      return;
    }

    const identity = user
      ? `\n\n—\nJoueur : ${[user.prenom, user.nom].filter(Boolean).join(" ") || "—"}\nTél : ${user.telephone || "—"}`
      : "";
    const body = `Sujet : ${contactForm.subject.trim()}\n\n${contactForm.message.trim()}${identity}`;

    window.open(supportWhatsAppHref(body), "_blank", "noopener,noreferrer");
    toast.success("WhatsApp ouvert avec votre message prérempli");
    setContactForm({ subject: "", message: "" });
  };

  return (
    <div className="page-container">
      <div className="flex items-center gap-3 responsive-padding py-4">
        <button onClick={() => navigate("/profil")} className="bg-muted rounded-full p-2">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="font-display font-bold text-lg sm:text-xl">Aide et support</h1>
      </div>

      <div className="max-w-2xl mx-auto">
        <div className="responsive-padding mt-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Rechercher une réponse..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>
        </div>

        <div className="responsive-padding mt-4">
          <h3 className="text-xs font-medium text-muted-foreground mb-3 uppercase tracking-wider">
            Nous contacter
          </h3>
          <div className="grid grid-cols-2 gap-3">
            <a
              href={`mailto:${supportEmail}?subject=${encodeURIComponent("Support TerrainSN")}`}
              className="glass-card p-4 flex flex-col items-center gap-2 hover:bg-muted/50 transition-colors"
            >
              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                <Mail className="w-5 h-5 text-primary" />
              </div>
              <span className="text-xs font-medium">Email</span>
              <span className="text-[10px] text-muted-foreground text-center break-all">{supportEmail}</span>
            </a>
            {supportPhoneDisplay ? (
              <a
                href={`tel:+${supportPhoneDigits.startsWith("221") ? supportPhoneDigits : `221${supportPhoneDigits}`}`}
                className="glass-card p-4 flex flex-col items-center gap-2 hover:bg-muted/50 transition-colors"
              >
                <div className="w-10 h-10 rounded-full bg-accent/20 flex items-center justify-center">
                  <Phone className="w-5 h-5 text-accent-foreground" />
                </div>
                <span className="text-xs font-medium">Téléphone</span>
                <span className="text-[10px] text-muted-foreground">{supportPhoneDisplay}</span>
              </a>
            ) : (
              <a
                href={supportWhatsAppHref("Bonjour, j'ai besoin d'aide sur TerrainSN.")}
                target="_blank"
                rel="noreferrer"
                className="glass-card p-4 flex flex-col items-center gap-2 hover:bg-muted/50 transition-colors"
              >
                <div className="w-10 h-10 rounded-full bg-accent/20 flex items-center justify-center">
                  <MessageCircle className="w-5 h-5 text-accent-foreground" />
                </div>
                <span className="text-xs font-medium">WhatsApp</span>
                <span className="text-[10px] text-muted-foreground">Support live</span>
              </a>
            )}
          </div>
        </div>

        <div className="responsive-padding mt-6">
          <h3 className="text-xs font-medium text-muted-foreground mb-3 uppercase tracking-wider">
            Questions fréquentes
          </h3>
          <div className="glass-card divide-y divide-border">
            {filteredFaq.length === 0 ? (
              <div className="p-8 text-center">
                <HelpCircle className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">Aucun résultat trouvé</p>
              </div>
            ) : (
              filteredFaq.map((item, index) => (
                <div key={item.question}>
                  <button
                    type="button"
                    onClick={() => setExpandedFaq(expandedFaq === index ? null : index)}
                    className="flex items-center justify-between w-full p-4 text-left hover:bg-muted/30 transition-colors"
                  >
                    <span className="text-sm font-medium pr-4">{item.question}</span>
                    {expandedFaq === index ? (
                      <ChevronUp className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                    ) : (
                      <ChevronDown className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                    )}
                  </button>
                  {expandedFaq === index && (
                    <div className="px-4 pb-4">
                      <p className="text-xs text-muted-foreground leading-relaxed">{item.answer}</p>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>

        {isAuthenticated && (
          <div className="responsive-padding mt-6">
            <h3 className="text-xs font-medium text-muted-foreground mb-3 uppercase tracking-wider">
              Envoyer un message
            </h3>
            <form onSubmit={handleContactSubmit} className="glass-card p-4 space-y-4">
              <p className="text-[11px] text-muted-foreground">
                Votre message s&apos;ouvrira dans WhatsApp, prérempli avec vos coordonnées. Aucune simulation.
              </p>
              <div className="space-y-2">
                <label className="text-sm font-medium">Sujet</label>
                <Input
                  placeholder="Ex: Problème de paiement"
                  value={contactForm.subject}
                  onChange={(e) => setContactForm((prev) => ({ ...prev, subject: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Message</label>
                <Textarea
                  placeholder="Décrivez votre problème ou votre question..."
                  rows={4}
                  value={contactForm.message}
                  onChange={(e) => setContactForm((prev) => ({ ...prev, message: e.target.value }))}
                />
              </div>
              <Button type="submit" variant="hero" className="w-full">
                <MessageCircle className="w-4 h-4 mr-2" />
                Ouvrir WhatsApp
              </Button>
            </form>
          </div>
        )}

        <div className="responsive-padding mt-6 pb-8">
          <div className="text-center">
            <p className="text-xs text-muted-foreground">TerrainSN</p>
            <p className="text-[10px] text-muted-foreground mt-1">
              © {new Date().getFullYear()} TerrainSN. Tous droits réservés.
            </p>
            <div className="flex items-center justify-center gap-4 mt-3">
              <button
                type="button"
                className="text-[10px] text-primary hover:underline"
                onClick={() => openLegal("cgu")}
              >
                Conditions d&apos;utilisation
              </button>
              <button
                type="button"
                className="text-[10px] text-primary hover:underline"
                onClick={() => openLegal("privacy")}
              >
                Politique de confidentialité
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProfilAide;
