import { ArrowLeft, HelpCircle, MessageCircle, Mail, Phone, ChevronDown, ChevronUp, Search } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Textarea } from "@/components/ui/textarea";

const faqItems = [
  {
    question: "Comment réserver un terrain ?",
    answer: "Pour réserver un terrain, rendez-vous dans l'onglet Explorer, sélectionnez le terrain de votre choix, choisissez la date et l'horaire souhaités, puis procédez au paiement. Votre réservation sera ensuite confirmée par le gérant."
  },
  {
    question: "Comment annuler une réservation ?",
    answer: "Vous pouvez annuler une réservation depuis l'onglet 'Mes réservations'. Les réservations en attente ou acceptées peuvent être annulées. Veuillez noter que les annulations sont soumises aux conditions du propriétaire."
  },
  {
    question: "Quels sont les moyens de paiement acceptés ?",
    answer: "Nous acceptons les paiements par Mobile Money (Orange Money, Wave, Free Money) ainsi que les cartes bancaires. Le paiement est sécurisé et traité par nos partenaires de confiance."
  },
  {
    question: "Comment contacter un propriétaire ?",
    answer: "Vous pouvez contacter un propriétaire directement depuis la page de détail du terrain. Un bouton 'Contacter' vous permettra d'envoyer un message ou d'appeler le numéro affiché."
  },
  {
    question: "Que faire en cas de problème sur place ?",
    answer: "En cas de problème, contactez d'abord le gérant du terrain. Si le problème persiste, notre équipe support est disponible pour vous aider. Conservez toujours votre numéro de réservation."
  },
  {
    question: "Comment laisser un avis ?",
    answer: "Après une réservation effectuée, vous pouvez laisser un avis et une note pour le terrain depuis l'onglet 'Mes réservations'. Vos avis aident la communauté à faire de meilleurs choix."
  },
];

const ProfilAide = () => {
  const navigate = useNavigate();
  const { isAuthenticated, user } = useAuth();
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedFaq, setExpandedFaq] = useState<number | null>(null);
  const [contactForm, setContactForm] = useState({
    subject: "",
    message: "",
  });
  const [sending, setSending] = useState(false);

  const filteredFaq = faqItems.filter(item =>
    item.question.toLowerCase().includes(searchQuery.toLowerCase()) ||
    item.answer.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleContactSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!contactForm.subject.trim() || !contactForm.message.trim()) {
      toast.error("Veuillez remplir tous les champs");
      return;
    }

    setSending(true);
    try {
      // Simulate API call
      await new Promise(resolve => setTimeout(resolve, 1000));
      toast.success("Message envoyé avec succès ! Nous vous répondrons sous 24h.");
      setContactForm({ subject: "", message: "" });
    } catch (err: any) {
      toast.error(err.message || "Erreur lors de l'envoi du message");
    } finally {
      setSending(false);
    }
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
        {/* Search */}
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

        {/* Quick Contact Options */}
        <div className="responsive-padding mt-4">
          <h3 className="text-xs font-medium text-muted-foreground mb-3 uppercase tracking-wider">
            Nous contacter
          </h3>
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => window.open('mailto:support@terrainsn.sn')}
              className="glass-card p-4 flex flex-col items-center gap-2 hover:bg-muted/50 transition-colors"
            >
              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                <Mail className="w-5 h-5 text-primary" />
              </div>
              <span className="text-xs font-medium">Email</span>
              <span className="text-[10px] text-muted-foreground">support@terrainsn.sn</span>
            </button>
            <button
              onClick={() => window.open('tel:+221330000000')}
              className="glass-card p-4 flex flex-col items-center gap-2 hover:bg-muted/50 transition-colors"
            >
              <div className="w-10 h-10 rounded-full bg-accent/20 flex items-center justify-center">
                <Phone className="w-5 h-5 text-accent-foreground" />
              </div>
              <span className="text-xs font-medium">Téléphone</span>
              <span className="text-[10px] text-muted-foreground">+221 33 000 00 00</span>
            </button>
          </div>
        </div>

        {/* FAQ */}
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
                <div key={index}>
                  <button
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

        {/* Contact Form */}
        {isAuthenticated && (
          <div className="responsive-padding mt-6">
            <h3 className="text-xs font-medium text-muted-foreground mb-3 uppercase tracking-wider">
              Envoyer un message
            </h3>
            <form onSubmit={handleContactSubmit} className="glass-card p-4 space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Sujet</label>
                <Input
                  placeholder="Ex: Problème de paiement"
                  value={contactForm.subject}
                  onChange={(e) => setContactForm(prev => ({ ...prev, subject: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Message</label>
                <Textarea
                  placeholder="Décrivez votre problème ou votre question..."
                  rows={4}
                  value={contactForm.message}
                  onChange={(e) => setContactForm(prev => ({ ...prev, message: e.target.value }))}
                />
              </div>
              <Button type="submit" variant="hero" className="w-full" disabled={sending}>
                {sending ? "Envoi..." : "Envoyer le message"}
              </Button>
            </form>
          </div>
        )}

        {/* App Info */}
        <div className="responsive-padding mt-6 pb-8">
          <div className="text-center">
            <p className="text-xs text-muted-foreground">TerrainSN v1.0.0</p>
            <p className="text-[10px] text-muted-foreground mt-1">
              © 2024 TerrainSN. Tous droits réservés.
            </p>
            <div className="flex items-center justify-center gap-4 mt-3">
              <button className="text-[10px] text-primary hover:underline">Conditions d'utilisation</button>
              <button className="text-[10px] text-primary hover:underline">Politique de confidentialité</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProfilAide;