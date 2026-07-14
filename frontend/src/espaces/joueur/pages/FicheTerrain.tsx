import { ArrowLeft, MapPin, Star, Clock, Phone, Share2, Users, Info, MessageCircle } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { useState, useEffect } from "react";
import { toast } from "sonner";
import { terrainsApi } from "@/lib/api";
import { useAuth } from "@/hooks/use-auth";
import FieldPhoto, { resolveTerrainPhoto } from "@/espaces/joueur/components/FieldPhoto";

const FieldDetails = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();
  const [terrain, setTerrain] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState(0);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [selectedDuration, setSelectedDuration] = useState(2);
  const [fieldFormat, setFieldFormat] = useState<"moitie" | "entier">("entier");
  const [creneaux, setCreneaux] = useState<any[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);

  const dates = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() + i);
    return {
      day: d.getDate(),
      weekday: ["Dim", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam"][d.getDay()],
      month: ["Jan", "Fév", "Mar", "Avr", "Mai", "Jun", "Jul", "Aoû", "Sep", "Oct", "Nov", "Déc"][d.getMonth()],
      isToday: i === 0,
      isoDate: d.toISOString().split("T")[0],
    };
  });

  useEffect(() => {
    loadTerrain();
  }, [id]);

  useEffect(() => {
    if (terrain) {
      loadCreneaux(dates[selectedDate].isoDate);
    }
  }, [selectedDate, terrain]);

  const loadTerrain = async () => {
    try {
      const data = await terrainsApi.get(id!);
      setTerrain(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const loadCreneaux = async (date: string) => {
    setLoadingSlots(true);
    try {
      const data = await terrainsApi.getCreneaux(id!, date);
      setCreneaux(data.creneaux || []);
    } catch (err) {
      console.error(err);
      setCreneaux([]);
    } finally {
      setLoadingSlots(false);
    }
  };

  const getEndTime = (startSlot: string, duration: number) => {
    const h = parseInt(startSlot.split(":")[0]) + duration;
    return `${h.toString().padStart(2, "0")}:00`;
  };

  const hourlyPrice = terrain
    ? Number(fieldFormat === "moitie" ? terrain.prix_moitie : terrain.prix_entier || terrain.prix_heure)
    : 0;
  const total = hourlyPrice * selectedDuration;
  const deposit = Math.min(Number(terrain?.montant_acompte || 5000), total);

  const paymentPath = () =>
    `/paiement/${terrain.id}?montant=${total}&slot=${selectedSlot}&duree=${selectedDuration}&date=${dates[selectedDate].isoDate}&format=${fieldFormat}`;

  const requireLoginThen = (fullPath: string) => {
    if (!isAuthenticated) {
      toast.message("Connectez-vous pour réserver");
      const q = fullPath.indexOf("?");
      navigate("/login", {
        state: {
          from: {
            pathname: q >= 0 ? fullPath.slice(0, q) : fullPath,
            search: q >= 0 ? fullPath.slice(q) : "",
          },
        },
      });
      return false;
    }
    return true;
  };

  const goToPayment = () => {
    if (!selectedSlot || !terrain) return;
    const path = paymentPath();
    if (!requireLoginThen(path)) return;
    navigate(path);
  };

  const getWhatsAppLink = () => {
    if (!terrain?.employe?.whatsapp_number) return null;
    const numero = terrain.employe.whatsapp_number.replace(/[^0-9]/g, "");
    const dateStr = dates[selectedDate];
    const message = encodeURIComponent(
      `Bonjour, je souhaite réserver le terrain ${terrain.nom} le ${dateStr.day} ${dateStr.month} de ${selectedSlot || "..."} à ${selectedSlot ? getEndTime(selectedSlot, selectedDuration) : "..."}. Montant : ${total.toLocaleString()} FCFA. Merci de confirmer.`
    );
    return `https://wa.me/${numero}?text=${message}`;
  };

  const openWhatsAppReservation = (e: React.MouseEvent) => {
    if (!isAuthenticated) {
      e.preventDefault();
      toast.message("Connectez-vous pour réserver");
      navigate("/login", {
        state: { from: { pathname: `/terrain/${terrain.id}`, search: "" } },
      });
    }
  };

  if (loading) {
    return (
      <div className="page-container flex items-center justify-center">
        <div className="animate-pulse text-[var(--color-text-secondary)] text-sm">Chargement...</div>
      </div>
    );
  }

  if (!terrain) {
    return (
      <div className="page-container flex items-center justify-center">
        <div className="text-[var(--color-text-secondary)] text-sm">Terrain non trouvé</div>
      </div>
    );
  }

  const horaire = terrain.horaires?.find((h: any) => {
    const jourMap = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
    const d = new Date(dates[selectedDate].isoDate);
    return h.jour === jourMap[d.getDay()];
  });

  const infoPills = [
    { label: terrain.type || "Terrain", icon: Users },
    {
      label: horaire ? `${horaire.heure_debut}–${horaire.heure_fin}` : "08h–22h",
      icon: Clock,
    },
    {
      label: `${Number(terrain.prix_heure || 0).toLocaleString()} CFA/h`,
      icon: null,
    },
  ];

  return (
    <div className="page-container !pb-28">
      <div className="relative h-[240px]">
        <FieldPhoto
          id={terrain.id}
          alt={terrain.nom}
          heightClass="h-[240px]"
          className="rounded-none"
          src={resolveTerrainPhoto(terrain)}
        />
        <div className="absolute inset-0 bg-gradient-to-b from-black/35 to-transparent" />
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="absolute top-4 left-4 w-10 h-10 rounded-full bg-white flex items-center justify-center shadow-md"
          aria-label="Retour"
        >
          <ArrowLeft className="w-5 h-5 text-[var(--color-text-primary)]" />
        </button>
        <button
          type="button"
          className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white flex items-center justify-center shadow-md"
          aria-label="Partager"
        >
          <Share2 className="w-5 h-5 text-[var(--color-text-primary)]" />
        </button>
      </div>

      <div className="responsive-padding -mt-5 relative z-10 max-w-3xl mx-auto">
        <div className="bg-white rounded-[var(--radius-lg)] border border-[var(--color-border)] p-4 sm:p-6 shadow-sm">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h1
                className="font-semibold text-lg sm:text-xl text-[var(--color-text-primary)]"
                style={{ fontFamily: "var(--font-display)" }}
              >
                {terrain.nom}
              </h1>
              <div className="flex items-center gap-1.5 text-[var(--color-text-secondary)] text-xs sm:text-sm mt-1">
                <MapPin className="w-3.5 h-3.5 flex-shrink-0" />
                <span className="break-words">
                  {terrain.adresse}, {terrain.ville}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-1 bg-[var(--color-surface-2)] rounded-full px-2.5 py-1 flex-shrink-0">
              <Star className="w-3.5 h-3.5 fill-[var(--color-accent)] text-[var(--color-accent)]" />
              <span className="text-xs font-semibold">{terrain.note || 0}</span>
            </div>
          </div>

          <div className="flex gap-2 mt-4 overflow-x-auto scrollbar-hide pb-1">
            {infoPills.map((pill, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-1.5 flex-shrink-0 px-3 min-h-[36px] rounded-full bg-[var(--color-surface-2)] text-[13px] text-[var(--color-text-secondary)]"
              >
                {pill.icon && <pill.icon className="w-3.5 h-3.5" />}
                {pill.label}
              </span>
            ))}
            {terrain.telephone && (
              <span className="inline-flex items-center gap-1.5 flex-shrink-0 px-3 min-h-[36px] rounded-full bg-[var(--color-surface-2)] text-[13px] text-[var(--color-text-secondary)]">
                <Phone className="w-3.5 h-3.5" />
                {terrain.telephone}
              </span>
            )}
          </div>

          {terrain.description && (
            <p className="text-sm text-[var(--color-text-secondary)] mt-4 leading-relaxed">
              {terrain.description}
            </p>
          )}
        </div>
      </div>

      <div className="max-w-3xl mx-auto">
        <section className="responsive-padding mt-6">
          <h2 className="section-title mb-3">Choisir la date</h2>
          <div className="flex gap-2 overflow-x-auto scrollbar-hide">
            {dates.map((d, i) => (
              <button
                key={i}
                type="button"
                onClick={() => {
                  setSelectedDate(i);
                  setSelectedSlot(null);
                }}
                className={`flex flex-col items-center min-w-[3.5rem] min-h-[68px] py-2 px-3 rounded-[var(--radius-md)] text-xs font-medium transition-colors ${
                  selectedDate === i
                    ? "bg-[var(--color-primary)] text-white"
                    : "bg-white border border-[var(--color-border)] text-[var(--color-text-secondary)]"
                }`}
              >
                <span className="text-[10px] opacity-80">{d.isToday ? "Auj." : d.weekday}</span>
                <span
                  className="text-base font-semibold mt-0.5"
                  style={{ fontFamily: "var(--font-display)" }}
                >
                  {d.day}
                </span>
                <span className="text-[9px] mt-0.5 opacity-80">{d.month}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="responsive-padding mt-6">
          <h2 className="section-title mb-3">Créneaux</h2>
          {loadingSlots ? (
            <div className="text-center py-6 text-[var(--color-text-secondary)] text-sm animate-pulse">
              Chargement des créneaux...
            </div>
          ) : creneaux.length === 0 ? (
            <div className="text-center py-6 text-[var(--color-text-secondary)] text-sm">
              Aucun créneau disponible ce jour
            </div>
          ) : (
            <>
              <div className="grid grid-cols-3 min-[390px]:grid-cols-4 sm:grid-cols-6 gap-2">
                {creneaux.map((slot) => {
                  const selected = selectedSlot === slot.heure;
                  let pillClass =
                    "bg-[var(--color-surface-2)] text-[var(--color-text-muted)] cursor-not-allowed line-through";
                  if (slot.disponible) {
                    pillClass = selected
                      ? "bg-[var(--color-primary)] text-white shadow-sm"
                      : "bg-[color-mix(in_srgb,var(--color-primary)_12%,white)] text-[var(--color-primary)]";
                  } else {
                    pillClass =
                      "bg-[color-mix(in_srgb,var(--color-danger)_10%,white)] text-[var(--color-danger)]/50 cursor-not-allowed line-through";
                  }
                  return (
                    <button
                      key={slot.heure}
                      type="button"
                      disabled={!slot.disponible}
                      onClick={() => setSelectedSlot(slot.heure)}
                      className={`min-h-[48px] rounded-full text-xs sm:text-sm font-medium transition-colors ${pillClass}`}
                    >
                      {slot.heure}
                    </button>
                  );
                })}
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-3 text-[11px] text-[var(--color-text-muted)]">
                <span className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-[color-mix(in_srgb,var(--color-primary)_40%,white)]" />{" "}
                  Libre
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-[color-mix(in_srgb,var(--color-danger)_25%,white)]" />{" "}
                  Complet
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-[var(--color-primary)]" /> Sélectionné
                </span>
              </div>
            </>
          )}
        </section>

        <section className="responsive-padding mt-6">
          <h2 className="section-title mb-3">Format</h2>
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                ["moitie", "Moitié", terrain.prix_moitie],
                ["entier", "Entier", terrain.prix_entier || terrain.prix_heure],
              ] as const
            ).map(([value, label, price]) => (
              <button
                key={value}
                type="button"
                onClick={() => setFieldFormat(value)}
                className={`rounded-[var(--radius-md)] p-3 text-left min-h-[72px] transition-colors border ${
                  fieldFormat === value
                    ? "bg-[var(--color-primary)] text-white border-[var(--color-primary)]"
                    : "bg-white border-[var(--color-border)] text-[var(--color-text-primary)]"
                }`}
              >
                <span className="block text-sm font-semibold">{label}</span>
                <span className="text-xs opacity-80">{Number(price || 0).toLocaleString()} CFA/h</span>
              </button>
            ))}
          </div>
        </section>

        <section className="responsive-padding mt-5">
          <h2 className="section-title mb-3">Durée</h2>
          <div className="flex gap-2">
            {[1, 2, 3].map((h) => (
              <button
                key={h}
                type="button"
                onClick={() => setSelectedDuration(h)}
                className={`flex-1 min-h-[48px] rounded-[var(--radius-md)] text-sm font-medium transition-colors ${
                  selectedDuration === h
                    ? "bg-[var(--color-primary)] text-white"
                    : "bg-white border border-[var(--color-border)] text-[var(--color-text-secondary)]"
                }`}
              >
                {h}h
              </button>
            ))}
          </div>
        </section>

        <section className="responsive-padding mt-4">
          <div className="flex items-start gap-2 bg-[color-mix(in_srgb,var(--color-primary)_8%,white)] rounded-[var(--radius-md)] p-3">
            <Info className="w-4 h-4 text-[var(--color-primary)] flex-shrink-0 mt-0.5" />
            <p className="text-xs text-[var(--color-text-secondary)] leading-relaxed">
              La réservation expire après 15 minutes sans paiement. Annulation gratuite jusqu&apos;à 2h
              avant le créneau.
            </p>
          </div>
        </section>

        {terrain.employe?.whatsapp_number && (
          <section className="responsive-padding mt-4">
            <a
              href={getWhatsAppLink() || "#"}
              target="_blank"
              rel="noopener noreferrer"
              onClick={openWhatsAppReservation}
              className="flex items-center justify-center gap-2 w-full min-h-[52px] rounded-[var(--radius-md)] text-white text-sm font-medium"
              style={{ backgroundColor: "#25D366" }}
              id="whatsapp-reservation-btn"
            >
              <MessageCircle className="w-5 h-5" />
              Réserver via WhatsApp
            </a>
          </section>
        )}

        {terrain.avis && terrain.avis.length > 0 && (
          <section className="responsive-padding mt-6 pb-4">
            <h2 className="section-title mb-3">Avis</h2>
            <div className="flex flex-col gap-2">
              {terrain.avis.map((a: any) => (
                <div
                  key={a.id}
                  className="bg-white border border-[var(--color-border)] rounded-[var(--radius-md)] p-3"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-sm">{a.joueur_nom}</span>
                    <div className="flex items-center gap-1">
                      <Star className="w-3 h-3 fill-[var(--color-accent)] text-[var(--color-accent)]" />
                      <span className="text-xs font-semibold">{a.note}</span>
                    </div>
                  </div>
                  <p className="text-xs text-[var(--color-text-secondary)] mt-1">{a.commentaire}</p>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>

      {/* Sticky bottom CTA */}
      <div className="fixed bottom-[calc(52px+env(safe-area-inset-bottom))] inset-x-0 z-30 border-t border-[var(--color-border)] bg-white/95 backdrop-blur-sm px-4 py-3">
        <div className="max-w-3xl mx-auto flex items-center gap-4">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] text-[var(--color-text-muted)]">Acompte</p>
            <p
              className="text-lg font-semibold text-[var(--color-primary)] truncate"
              style={{ fontFamily: "var(--font-display)" }}
            >
              {deposit.toLocaleString()} CFA
            </p>
          </div>
          <button
            type="button"
            disabled={!selectedSlot}
            onClick={goToPayment}
            className="flex-1 max-w-[240px] min-h-[52px] rounded-[var(--radius-md)] bg-[var(--color-primary)] text-white text-sm font-medium disabled:bg-[var(--color-text-muted)] disabled:cursor-not-allowed hover:bg-[var(--color-primary-light)]"
          >
            {isAuthenticated ? "Choisir ce créneau" : "Se connecter pour réserver"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default FieldDetails;
