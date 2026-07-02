import { ArrowLeft, MapPin, Star, Clock, Phone, Share2, Users, Info, MessageCircle } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { useState, useEffect } from "react";
import { terrainsApi } from "@/lib/api";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";

const FieldDetails = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();
  const [terrain, setTerrain] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState(0);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [selectedDuration, setSelectedDuration] = useState(2);
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
      isoDate: d.toISOString().split('T')[0],
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
    const h = parseInt(startSlot.split(':')[0]) + duration;
    return `${h.toString().padStart(2, '0')}:00`;
  };

  const total = terrain ? terrain.prix_heure * selectedDuration : 0;

  // Générer le lien WhatsApp pré-rempli
  const getWhatsAppLink = () => {
    if (!terrain?.employe?.whatsapp_number) return null;
    const numero = terrain.employe.whatsapp_number.replace(/[^0-9]/g, '');
    const dateStr = dates[selectedDate];
    const message = encodeURIComponent(
      `Bonjour, je souhaite réserver le terrain ${terrain.nom} le ${dateStr.day} ${dateStr.month} de ${selectedSlot || '...'} à ${selectedSlot ? getEndTime(selectedSlot, selectedDuration) : '...'}. Montant : ${total.toLocaleString()} FCFA. Merci de confirmer.`
    );
    return `https://wa.me/${numero}?text=${message}`;
  };

  if (loading) {
    return (
      <div className="page-container flex items-center justify-center">
        <div className="animate-pulse text-muted-foreground">Chargement...</div>
      </div>
    );
  }

  if (!terrain) {
    return (
      <div className="page-container flex items-center justify-center">
        <div className="text-muted-foreground">Terrain non trouvé</div>
      </div>
    );
  }

  const horaire = terrain.horaires?.find((h: any) => {
    const jourMap = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
    const d = new Date(dates[selectedDate].isoDate);
    return h.jour === jourMap[d.getDay()];
  });

  // Image par défaut basée sur l'id du terrain
  const defaultImages = [
    '/src/assets/field-1.jpg',
    '/src/assets/field-2.jpg',
    '/src/assets/field-3.jpg',
    '/src/assets/field-4.jpg',
  ];
  const terrainImage = defaultImages[(terrain.id - 1) % defaultImages.length];

  return (
    <div className="page-container">
      {/* Header image */}
      <div className="relative h-52 sm:h-64 lg:h-80">
        <img src={terrainImage} alt={terrain.nom} className="w-full h-full object-cover" width={400} height={208} />
        <div className="absolute inset-0 bg-gradient-to-b from-foreground/30 to-transparent" />
        <button onClick={() => navigate(-1)} className="absolute top-4 left-4 bg-card/80 backdrop-blur-sm rounded-full p-2">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <button className="absolute top-4 right-4 bg-card/80 backdrop-blur-sm rounded-full p-2">
          <Share2 className="w-5 h-5" />
        </button>
      </div>

      <div className="responsive-padding -mt-4 relative z-10 max-w-3xl mx-auto">
        <div className="glass-card p-4 sm:p-6">
          <div className="flex items-start justify-between">
            <div>
              <h1 className="font-display font-bold text-lg sm:text-xl lg:text-2xl">{terrain.nom}</h1>
              <div className="flex items-center gap-1.5 text-muted-foreground text-xs sm:text-sm mt-1">
                <MapPin className="w-3 h-3" />
                <span>{terrain.adresse}, {terrain.ville}</span>
              </div>
            </div>
            <div className="flex items-center gap-1 bg-accent rounded-full px-2.5 py-1">
              <Star className="w-3.5 h-3.5 fill-secondary text-secondary" />
              <span className="text-xs font-bold">{terrain.note || 0}</span>
              <span className="text-[10px] text-muted-foreground">({terrain.avis_count || 0})</span>
            </div>
          </div>

          <div className="flex flex-wrap gap-3 sm:gap-4 mt-3 text-xs sm:text-sm text-muted-foreground">
            <div className="flex items-center gap-1"><Clock className="w-3 h-3" /> {horaire ? `${horaire.heure_debut} - ${horaire.heure_fin}` : '08h - 22h'}</div>
            <div className="flex items-center gap-1"><Phone className="w-3 h-3" /> {terrain.telephone || 'N/A'}</div>
            <div className="flex items-center gap-1"><Users className="w-3 h-3" /> {terrain.type}</div>
          </div>

          <p className="text-xs sm:text-sm text-muted-foreground mt-3">{terrain.description}</p>
        </div>
      </div>

      <div className="max-w-3xl mx-auto">
        {/* Date picker */}
        <section className="responsive-padding mt-5">
          <h2 className="section-title mb-3">📅 Choisir la date</h2>
          <div className="flex gap-2 overflow-x-auto scrollbar-hide">
            {dates.map((d, i) => (
              <button
                key={i}
                onClick={() => { setSelectedDate(i); setSelectedSlot(null); }}
                className={`flex flex-col items-center min-w-[3.5rem] py-2 px-3 rounded-xl text-xs font-medium transition-colors ${
                  selectedDate === i ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                }`}
              >
                <span className="text-[10px]">{d.isToday ? "Auj." : d.weekday}</span>
                <span className="text-base font-bold mt-0.5">{d.day}</span>
                <span className="text-[9px] mt-0.5">{d.month}</span>
              </button>
            ))}
          </div>
        </section>

        {/* Time slots */}
        <section className="responsive-padding mt-5">
          <h2 className="section-title mb-3">⏰ Créneaux disponibles</h2>
          {loadingSlots ? (
            <div className="text-center py-6 text-muted-foreground text-sm animate-pulse">Chargement des créneaux...</div>
          ) : creneaux.length === 0 ? (
            <div className="text-center py-6 text-muted-foreground text-sm">Aucun créneau disponible ce jour</div>
          ) : (
            <>
              <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
                {creneaux.map((slot) => (
                  <button
                    key={slot.heure}
                    disabled={!slot.disponible}
                    onClick={() => setSelectedSlot(slot.heure)}
                    className={`py-2.5 rounded-xl text-xs sm:text-sm font-medium transition-colors ${
                      !slot.disponible
                        ? "bg-muted/50 text-muted-foreground/40 cursor-not-allowed line-through"
                        : selectedSlot === slot.heure
                        ? "bg-primary text-primary-foreground shadow-sm"
                        : "bg-accent text-accent-foreground hover:bg-accent/80"
                    }`}
                  >
                    {slot.heure}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-4 mt-2 text-[10px] sm:text-xs text-muted-foreground">
                <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded bg-accent inline-block" /> Disponible</span>
                <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded bg-muted/50 inline-block" /> Occupé</span>
                <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded bg-primary inline-block" /> Sélectionné</span>
              </div>
            </>
          )}
        </section>

        {/* Duration */}
        <section className="responsive-padding mt-5">
          <h2 className="section-title mb-3">⏱️ Durée (heures)</h2>
          <div className="flex gap-2">
            {[1, 2, 3].map((h) => (
              <button
                key={h}
                onClick={() => setSelectedDuration(h)}
                className={`flex-1 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                  selectedDuration === h ? "bg-primary text-primary-foreground shadow-sm" : "bg-muted text-muted-foreground hover:bg-muted/80"
                }`}
              >
                {h}h
              </button>
            ))}
          </div>
        </section>

        {/* Info */}
        <section className="responsive-padding mt-4">
          <div className="flex items-start gap-2 bg-accent/50 rounded-xl p-3">
            <Info className="w-4 h-4 text-accent-foreground flex-shrink-0 mt-0.5" />
            <p className="text-[11px] sm:text-xs text-accent-foreground">
              La réservation expire après 15 minutes sans paiement. L'annulation est gratuite jusqu'à 2h avant le créneau.
            </p>
          </div>
        </section>

        {/* WhatsApp Button */}
        {terrain.employe?.whatsapp_number && (
          <section className="responsive-padding mt-4">
            <a
              href={getWhatsAppLink() || '#'}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-3 w-full py-4 rounded-2xl text-white font-display font-bold text-base transition-all hover:opacity-90 active:scale-[0.98]"
              style={{ backgroundColor: '#25D366' }}
              id="whatsapp-reservation-btn"
            >
              <MessageCircle className="w-6 h-6" />
              Réserver via WhatsApp
            </a>
          </section>
        )}

        {/* Total & CTA */}
        <section className="responsive-padding mt-4 pb-4">
          <div className="glass-card p-4 sm:p-6">
            <div className="flex items-center justify-between mb-3">
              <div>
                <span className="text-sm text-muted-foreground">Total à payer</span>
                <p className="text-[10px] text-muted-foreground">{terrain.prix_heure.toLocaleString()} CFA × {selectedDuration}h</p>
              </div>
              <span className="font-display font-bold text-xl sm:text-2xl text-primary">{total.toLocaleString()} CFA</span>
            </div>
            <Button
              variant="hero"
              className="w-full h-12 text-base"
              onClick={() => {
                navigate(`/paiement/${terrain.id}?montant=${total}&slot=${selectedSlot}&duree=${selectedDuration}&date=${dates[selectedDate].isoDate}`);
              }}
              disabled={!selectedSlot}
            >
              ⚽ Réserver maintenant
            </Button>
          </div>
        </section>

        {/* Avis */}
        {terrain.avis && terrain.avis.length > 0 && (
          <section className="responsive-padding mt-2 pb-4">
            <h2 className="section-title mb-3">💬 Avis des joueurs</h2>
            <div className="flex flex-col gap-2">
              {terrain.avis.map((a: any) => (
                <div key={a.id} className="glass-card p-3">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-sm">{a.joueur_nom}</span>
                    <div className="flex items-center gap-1">
                      <Star className="w-3 h-3 fill-secondary text-secondary" />
                      <span className="text-xs font-bold">{a.note}</span>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">{a.commentaire}</p>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
};

export default FieldDetails;
