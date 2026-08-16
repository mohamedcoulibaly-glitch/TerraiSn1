import { calculerMontantAvance } from "@/lib/avance";
import { ArrowLeft, ShieldCheck, MessageCircle, Check } from "lucide-react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useState, useEffect } from "react";
import { terrainsApi, reservationsApi } from "@/lib/api";
import { hapticSuccess, hapticError } from "@/lib/haptics";
import { registerBackgroundSync } from "@/lib/pwaRegister";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { formatPhoneDisplay, phoneError, toLocal9 } from "@/auth/phone";
import { fieldImageForId } from "@/espaces/joueur/components/FieldPhoto";

import omIcon from "@/assets/images.png";
import waveIcon from "@/assets/wave-banque-en-ligne-au-senegal-pour-paiement-transfert-argents.jpg";

const Payment = () => {
  const navigate = useNavigate();
  const { id } = useParams();
  const { user, isAuthenticated } = useAuth();
  const [searchParams] = useSearchParams();
  const montant = parseInt(searchParams.get("montant") || "0");
  const slot = searchParams.get("slot") || "";
  const duree = searchParams.get("duree") || "2";
  const date = searchParams.get("date") || new Date().toISOString().split("T")[0];
  const fieldFormat = searchParams.get("format") === "moitie" ? "moitie" : "entier";

  const [terrain, setTerrain] = useState<any>(null);
  const [selected, setSelected] = useState<"wave" | "orange_money" | "">("wave");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [processing, setProcessing] = useState(false);
  const deposit = calculerMontantAvance(montant, terrain?.pourcentage_avance);
  const reste = Math.max(0, montant - deposit);

  useEffect(() => {
    loadTerrain();
  }, [id]);

  useEffect(() => {
    if (!isAuthenticated || !user) return;
    setName((prev) => prev || [user.prenom, user.nom].filter(Boolean).join(" ") || user.nom || "");
    if (user.telephone) {
      setPhone((prev) => prev || formatPhoneDisplay(String(user.telephone)));
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

  const endTime = slot
    ? (() => {
        const h = parseInt(slot.split(":")[0]) + parseInt(duree);
        return `${h.toString().padStart(2, "0")}:00`;
      })()
    : "";

  const getWhatsAppLink = () => {
    if (!terrain?.employe?.whatsapp_number) return null;
    const numero = terrain.employe.whatsapp_number.replace(/[^0-9]/g, "");
    const message = encodeURIComponent(
      `Bonjour, je souhaite réserver le terrain ${terrain.nom} le ${date} de ${slot} à ${endTime}. Montant : ${montant.toLocaleString()} FCFA. Merci de confirmer.`
    );
    return `https://wa.me/${numero}?text=${message}`;
  };

  const handlePay = async () => {
    if (processing || !selected) return;
    const phoneErr = phoneError(phone);
    if (!name.trim() || phoneErr) {
      toast.error(phoneErr || "Veuillez saisir votre nom et numéro de téléphone");
      return;
    }
    setProcessing(true);
    try {
      const reservation = await reservationsApi.create({
        terrain_id: parseInt(id!),
        date,
        heure_debut: slot,
        heure_fin: endTime,
        joueur_nom: name,
        joueur_telephone: toLocal9(phone),
        format_terrain: fieldFormat,
      });

      localStorage.setItem("terrainsn_last_reservation_id", String(reservation.id));
      hapticSuccess();
      if (!reservation.redirect_url) throw new Error("Lien PayTech indisponible");
      window.location.assign(reservation.redirect_url);
    } catch (err: unknown) {
      const error = err as Error & { offline?: boolean };
      if (error.offline) {
        hapticSuccess();
        await registerBackgroundSync();
        toast.success(error.message);
        navigate("/reservations");
        return;
      }
      hapticError();
      toast.error(error.message || "Erreur lors du paiement");
    } finally {
      setProcessing(false);
    }
  };

  const payLabel =
    selected === "wave"
      ? `Payer ${deposit.toLocaleString()} FCFA avec Wave`
      : selected === "orange_money"
        ? `Payer ${deposit.toLocaleString()} FCFA avec Orange Money`
        : "Choisis un mode de paiement";

  const payBg =
    selected === "wave"
      ? "bg-[var(--color-wave)] hover:bg-[var(--color-wave-dark)]"
      : selected === "orange_money"
        ? "bg-[var(--color-orange-money)] hover:opacity-90"
        : "bg-[var(--color-text-muted)]";

  return (
    <div className="page-container page-enter pb-32">
      <div className="flex items-center gap-3 responsive-padding py-4">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="w-11 h-11 rounded-full bg-[var(--surface)] border border-[var(--color-border)] flex items-center justify-center"
          aria-label="Retour"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <p className="font-semibold text-sm text-[var(--color-primary)]" style={{ fontFamily: "var(--font-display)" }}>
            Paiement
          </p>
          <p className="text-[11px] text-[var(--color-text-muted)]">Avance sécurisée</p>
        </div>
      </div>

      <div className="max-w-lg mx-auto responsive-padding space-y-5">
        {terrain && (
          <div className="bg-[var(--surface)] rounded-[var(--radius-lg)] shadow-[var(--shadow-sm)] border border-[var(--color-border)] p-4">
            <div className="flex items-center gap-3">
              <img
                src={fieldImageForId(terrain.id)}
                alt={terrain.nom}
                className="w-[60px] h-[60px] rounded-[var(--radius-md)] object-cover"
              />
              <div className="min-w-0 flex-1">
                <h3 className="font-semibold text-sm truncate" style={{ fontFamily: "var(--font-display)" }}>
                  {terrain.nom}
                </h3>
                {slot && (
                  <p className="text-[12px] text-[var(--color-text-muted)] mt-0.5">
                    {date} · {slot} – {endTime}
                  </p>
                )}
              </div>
            </div>

            <div className="border-t border-dashed border-[var(--color-border)] my-4" />

            <div className="space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-[var(--color-text-muted)]">Prix total</span>
                <span className="text-[var(--color-text-secondary)]">{montant.toLocaleString()} FCFA</span>
              </div>
              <div className="rounded-[var(--radius-md)] bg-[var(--color-primary-glow)] p-3 flex justify-between items-center">
                <span className="text-sm text-[var(--color-text-primary)]">Avance à payer maintenant</span>
                <span className="text-[18px] font-bold text-[var(--color-primary)]" style={{ fontFamily: "var(--font-display)" }}>
                  {deposit.toLocaleString()} FCFA
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <div>
                  <span className="text-[var(--color-text-secondary)]">Reste le jour du match</span>
                  <p className="text-[12px] text-[var(--color-text-muted)]">À payer directement au gérant</p>
                </div>
                <span className="text-[var(--color-text-secondary)] font-medium">{reste.toLocaleString()} FCFA</span>
              </div>
            </div>
          </div>
        )}

        <div>
          <h2 className="text-[15px] font-semibold mb-3">Comment tu veux payer ?</h2>
          <div className="flex flex-col gap-3">
            <button
              type="button"
              onClick={() => setSelected("wave")}
              className={`flex items-center gap-3 p-4 rounded-[var(--radius-lg)] border-2 text-left ${
                selected === "wave"
                  ? "border-[var(--color-wave)] bg-[#E0F7FD]"
                  : "border-[var(--color-border)] bg-[var(--surface)]"
              }`}
            >
              <div className="w-11 h-11 rounded-full bg-[var(--color-wave)] overflow-hidden flex items-center justify-center">
                <img src={waveIcon} alt="" className="w-full h-full object-cover" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm">Wave</p>
                <p className="text-[12px] text-[var(--color-text-muted)]">Paiement instantané</p>
              </div>
              <span
                className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                  selected === "wave" ? "border-[var(--color-wave)] bg-[var(--color-wave)] text-white" : "border-[var(--color-border-strong)]"
                }`}
              >
                {selected === "wave" && <Check className="w-3 h-3" />}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setSelected("orange_money")}
              className={`flex items-center gap-3 p-4 rounded-[var(--radius-lg)] border-2 text-left ${
                selected === "orange_money"
                  ? "border-[var(--color-orange-money)] bg-[#FFF3E0]"
                  : "border-[var(--color-border)] bg-[var(--surface)]"
              }`}
            >
              <div className="w-11 h-11 rounded-full bg-[var(--color-orange-money)] overflow-hidden flex items-center justify-center">
                <img src={omIcon} alt="" className="w-full h-full object-cover" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm">Orange Money</p>
                <p className="text-[12px] text-[var(--color-text-muted)]">Paiement mobile</p>
              </div>
              <span
                className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                  selected === "orange_money"
                    ? "border-[var(--color-orange-money)] bg-[var(--color-orange-money)] text-white"
                    : "border-[var(--color-border-strong)]"
                }`}
              >
                {selected === "orange_money" && <Check className="w-3 h-3" />}
              </span>
            </button>
          </div>
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-[12px] text-[var(--color-text-muted)]">Nom complet</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 w-full h-12 px-4 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--surface)] text-sm outline-none focus:border-[var(--color-primary)]"
              id="payment-name"
            />
          </div>
          <div>
            <label className="text-[12px] text-[var(--color-text-muted)]">Téléphone</label>
            <div className="mt-1 flex items-center gap-2 h-12 px-4 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--surface)]">
              <span className="text-sm text-[var(--color-text-muted)] shrink-0 select-none">+221</span>
              <input
                type="tel"
                inputMode="numeric"
                autoComplete="tel-national"
                enterKeyHint="done"
                placeholder="77 000 00 00"
                value={phone}
                onChange={(e) => setPhone(formatPhoneDisplay(e.target.value))}
                className="flex-1 min-w-[8rem] bg-transparent outline-none text-sm min-h-[48px]"
                id="payment-phone"
                aria-label="Numéro Wave ou Orange Money"
              />
            </div>
          </div>
        </div>

        {terrain?.employe?.whatsapp_number && (
          <a
            href={getWhatsAppLink() || "#"}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 w-full h-12 rounded-[var(--radius-md)] text-white text-sm font-medium"
            style={{ backgroundColor: "#25D366" }}
          >
            <MessageCircle className="w-5 h-5" />
            Confirmer via WhatsApp
          </a>
        )}
      </div>

      <div className="fixed bottom-16 inset-x-0 z-30 border-t border-[var(--color-border)] bg-[var(--surface)] px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
        <div className="max-w-lg mx-auto">
          <div className="flex items-center gap-2 text-[11px] text-[var(--color-text-muted)] mb-2 justify-center">
            <ShieldCheck className="w-3.5 h-3.5 text-[var(--color-primary)]" />
            Paiement sécurisé
          </div>
          <button
            type="button"
            onClick={handlePay}
            disabled={processing || !selected}
            className={`w-full h-14 rounded-[var(--radius-lg)] text-white text-sm font-semibold disabled:opacity-50 ${payBg}`}
            style={{ fontFamily: "var(--font-display)" }}
          >
            {processing ? "Traitement..." : payLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

export default Payment;
