import { ArrowLeft, ShieldCheck, MessageCircle } from "lucide-react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useState, useEffect } from "react";
import { terrainsApi, reservationsApi } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { fieldImageForId } from "@/espaces/joueur/components/FieldPhoto";

import omIcon from "@/assets/images.png";
import waveIcon from "@/assets/wave-banque-en-ligne-au-senegal-pour-paiement-transfert-argents.jpg";

const paymentMethods = [
  { id: "wave", name: "Wave", img: waveIcon, desc: "Paiement instantané sans frais" },
  { id: "orange_money", name: "Orange Money", img: omIcon, desc: "Rapide et sécurisé" },
];

const Payment = () => {
  const navigate = useNavigate();
  const { id } = useParams();
  const { user, isAuthenticated } = useAuth();
  const [searchParams] = useSearchParams();
  const montant = parseInt(searchParams.get("montant") || "0");
  const slot = searchParams.get("slot") || "";
  const duree = searchParams.get("duree") || "2";
  const date = searchParams.get("date") || new Date().toISOString().split('T')[0];
  const fieldFormat = searchParams.get("format") === 'moitie' ? 'moitie' : 'entier';

  const [terrain, setTerrain] = useState<any>(null);
  const [selected, setSelected] = useState("wave");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [processing, setProcessing] = useState(false);
  const deposit = Math.min(Number(terrain?.montant_acompte || 5000), montant);

  useEffect(() => {
    loadTerrain();
  }, [id]);

  useEffect(() => {
    if (!isAuthenticated || !user) return;
    setName((prev) =>
      prev || [user.prenom, user.nom].filter(Boolean).join(" ") || user.nom || ""
    );
    if (user.telephone) {
      setPhone((prev) => prev || String(user.telephone).replace(/^\+221\s?/, ""));
    }
  }, [isAuthenticated, user]);

  const loadTerrain = async () => {
    try {
      const data = await terrainsApi.get(id!);
      setTerrain(data);
    } catch (err) {
      console.error(err);
    }
  };

  // Compute end time
  const endTime = slot ? (() => {
    const h = parseInt(slot.split(':')[0]) + parseInt(duree);
    return `${h.toString().padStart(2, '0')}:00`;
  })() : '';

  // WhatsApp link
  const getWhatsAppLink = () => {
    if (!terrain?.employe?.whatsapp_number) return null;
    const numero = terrain.employe.whatsapp_number.replace(/[^0-9]/g, '');
    const message = encodeURIComponent(
      `Bonjour, je souhaite réserver le terrain ${terrain.nom} le ${date} de ${slot} à ${endTime}. Montant : ${montant.toLocaleString()} FCFA. Merci de confirmer.`
    );
    return `https://wa.me/${numero}?text=${message}`;
  };

  const handlePay = async () => {
    if (processing) return;
    if (!name || !phone) {
      toast.error("Veuillez saisir votre nom et numéro de téléphone");
      return;
    }
    setProcessing(true);
    try {
      // 1. Créer la réservation
      const reservation = await reservationsApi.create({
        terrain_id: parseInt(id!),
        date,
        heure_debut: slot,
        heure_fin: endTime,
        joueur_nom: name,
        joueur_telephone: phone,
        format_terrain: fieldFormat,
      });

      localStorage.setItem('terrainsn_last_reservation_id', String(reservation.id));
      if (!reservation.redirect_url) throw new Error('Lien PayTech indisponible');
      window.location.assign(reservation.redirect_url);
    } catch (err: any) {
      toast.error(err.message || "Erreur lors du paiement");
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="page-container">
      <div className="flex items-center gap-3 responsive-padding py-4">
        <button onClick={() => navigate(-1)} className="bg-muted rounded-full p-2">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <p className="font-display font-bold text-sm sm:text-base text-primary">TerrainSN</p>
          <p className="text-[10px] sm:text-xs text-muted-foreground">Paiement sécurisé</p>
        </div>
      </div>

      <div className="max-w-2xl mx-auto">
        {/* Résumé */}
        {terrain && (
          <div className="responsive-padding">
            <div className="glass-card p-4 flex items-center gap-3">
              <img src={fieldImageForId(terrain.id)} alt={terrain.nom} className="w-16 h-16 rounded-xl object-cover" />
              <div className="flex-1 min-w-0">
                <h3 className="font-display font-semibold text-sm truncate">{terrain.nom}</h3>
                <p className="text-xs text-muted-foreground">{terrain.type} · {terrain.ville}</p>
                {slot && <p className="text-xs text-primary font-medium mt-0.5">{date} · {slot} - {endTime} · {duree}h</p>}
              </div>
            </div>
          </div>
        )}

        <div className="responsive-padding mt-4">
          <h1 className="font-display font-bold text-xl sm:text-2xl">Mode de paiement</h1>
          <p className="text-xs sm:text-sm text-muted-foreground mt-1">Uniquement Wave et Orange Money (conformément à la politique TerrainSN)</p>
        </div>

        <div className="responsive-padding mt-4 flex flex-col gap-3">
          {paymentMethods.map((method) => (
            <button
              key={method.id}
              onClick={() => setSelected(method.id)}
              className={`flex items-center gap-3 p-4 rounded-2xl border transition-all active:scale-[0.98] ${
                selected === method.id
                  ? "border-primary bg-accent shadow-sm"
                  : "border-border bg-card hover:border-primary/30"
              }`}
            >
              <div className={`w-10 h-10 sm:w-12 sm:h-12 overflow-hidden rounded-xl flex items-center justify-center transition-colors ${
                selected === method.id ? "ring-2 ring-primary bg-primary/10" : "bg-muted"
              }`}>
                <img src={method.img} alt={method.name} className="w-full h-full object-cover" />
              </div>
              <div className="text-left flex-1">
                <p className="font-display font-semibold text-sm sm:text-base">{method.name}</p>
                <p className="text-[11px] sm:text-xs text-muted-foreground">{method.desc}</p>
              </div>
              <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                selected === method.id ? "border-primary" : "border-muted"
              }`}>
                {selected === method.id && <div className="w-2.5 h-2.5 rounded-full bg-primary" />}
              </div>
            </button>
          ))}
        </div>

        <div className="responsive-padding mt-5 flex flex-col gap-4">
          <div>
            <label className="text-xs sm:text-sm font-medium text-muted-foreground">Nom et prénom complet</label>
            <div className="mt-1 flex items-center gap-2 bg-muted rounded-xl px-4 py-3">
              <input
                type="text"
                placeholder="Ex: Abdou Sow"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="flex-1 bg-transparent outline-none text-sm"
                id="payment-name"
              />
            </div>
          </div>
          <div>
            <label className="text-xs sm:text-sm font-medium text-muted-foreground">Numéro de téléphone</label>
            <div className="mt-1 flex items-center gap-2 bg-muted rounded-xl px-4 py-3">
              <span className="text-sm font-medium">+221</span>
              <input
                type="tel"
                placeholder="77 000 00 00"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="flex-1 bg-transparent outline-none text-sm"
                id="payment-phone"
              />
            </div>
          </div>
        </div>

        <div className="responsive-padding mt-5">
          <div className="glass-card p-4">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-sm text-muted-foreground">Acompte à payer maintenant</span>
                <p className="text-xs text-muted-foreground">Total {montant.toLocaleString()} CFA · solde {(montant - deposit).toLocaleString()} CFA après le match</p>
              </div>
              <span className="font-display font-bold text-xl sm:text-2xl text-primary whitespace-nowrap">{deposit.toLocaleString()} CFA</span>
            </div>
          </div>
        </div>

        {/* WhatsApp confirmation button */}
        {terrain?.employe?.whatsapp_number && (
          <div className="responsive-padding mt-4">
            <a
              href={getWhatsAppLink() || '#'}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-3 w-full py-3.5 rounded-2xl text-white font-display font-bold text-sm transition-all hover:opacity-90 active:scale-[0.98]"
              style={{ backgroundColor: '#25D366' }}
              id="whatsapp-confirm-btn"
            >
              <MessageCircle className="w-5 h-5" />
              Confirmer via WhatsApp
            </a>
          </div>
        )}

        <div className="responsive-padding mt-4">
          <div className="flex items-center gap-2 text-[10px] sm:text-xs text-muted-foreground mb-3">
            <ShieldCheck className="w-4 h-4 text-primary" />
            <span>Paiement sécurisé · Vos données sont protégées</span>
          </div>
          <Button variant="hero" className="w-full h-12 text-base" onClick={handlePay} disabled={processing}>
            {processing ? "Traitement en cours..." : `Payer l'acompte de ${deposit.toLocaleString()} CFA`}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default Payment;
