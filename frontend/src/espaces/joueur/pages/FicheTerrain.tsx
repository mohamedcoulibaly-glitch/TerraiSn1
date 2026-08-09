import { calculerMontantAvance } from "@/lib/avance";
import SkeletonFicheTerrain from "@/components/skeletons/SkeletonFicheTerrain";
import CommoditesSection from "@/components/CommoditesSection";
import { ArrowLeft, MapPin, Star, Clock, Heart, Info, MessageCircle, X, ChevronDown } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { useState, useEffect, useRef } from "react";
import { toast } from "sonner";
import { terrainsApi } from "@/lib/api";
import { useAuth } from "@/hooks/use-auth";
import { resolveTerrainPhotos } from "@/espaces/joueur/components/FieldPhoto";
import { favKey } from "@/espaces/joueur/components/FieldCard";

function toLocalISO(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatHourLabel(h: string) {
  // Conserve HH:MM (ex: 11:00)
  if (!h) return "";
  const [hh, mm = "00"] = h.split(":");
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

function getEndTime(startSlot: string, duration: number) {
  const h = parseInt(startSlot.split(":")[0], 10) + duration;
  return `${String(h).padStart(2, "0")}:00`;
}

const FieldDetails = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();
  const [terrain, setTerrain] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState(1);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [selectedDuration, setSelectedDuration] = useState(2);
  const [fieldFormat, setFieldFormat] = useState<"moitie" | "entier">("entier");
  const [creneaux, setCreneaux] = useState<any[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [photoIndex, setPhotoIndex] = useState(0);
  const [fav, setFav] = useState(false);
  const [carouselPaused, setCarouselPaused] = useState(false);
  const [avisOpen, setAvisOpen] = useState(false);
  const slotsSectionRef = useRef<HTMLDivElement | null>(null);
  const carouselRef = useRef<HTMLDivElement | null>(null);
  const pauseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dates = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() + i);
    return {
      day: d.getDate(),
      weekday: ["Dim", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam"][d.getDay()],
      month: ["Jan", "Fév", "Mar", "Avr", "Mai", "Jun", "Jul", "Aoû", "Sep", "Oct", "Nov", "Déc"][d.getMonth()],
      isToday: i === 0,
      isTomorrow: i === 1,
      isoDate: toLocalISO(d),
      shortLabel: i === 0 ? "Auj." : i === 1 ? "Demain" : null,
    };
  });

  useEffect(() => {
    loadTerrain();
  }, [id]);

  useEffect(() => {
    if (!terrain?.id) return;
    try {
      setFav(localStorage.getItem(favKey(terrain.id)) === "1");
    } catch {
      setFav(false);
    }
  }, [terrain?.id]);

  useEffect(() => {
    if (terrain) loadCreneaux(dates[selectedDate].isoDate);
  }, [selectedDate, terrain]);

  useEffect(() => {
    return () => {
      if (pauseTimerRef.current) clearTimeout(pauseTimerRef.current);
    };
  }, []);

  // Auto-défilement du carrousel photos
  useEffect(() => {
    if (!terrain || carouselPaused) return;
    const photosCount = resolveTerrainPhotos(terrain).length;
    if (photosCount <= 1) return;

    const timer = setInterval(() => {
      setPhotoIndex((prev) => {
        const next = (prev + 1) % photosCount;
        const el = carouselRef.current;
        if (el) {
          el.scrollTo({ left: next * el.clientWidth, behavior: "smooth" });
        }
        return next;
      });
    }, 3500);

    return () => clearInterval(timer);
  }, [terrain, carouselPaused]);

  const pauseCarouselTemporarily = () => {
    setCarouselPaused(true);
    if (pauseTimerRef.current) clearTimeout(pauseTimerRef.current);
    pauseTimerRef.current = setTimeout(() => setCarouselPaused(false), 6000);
  };

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
      let slots = data.creneaux || [];
      if (slots.length === 0) {
        slots = ["18:00", "19:00", "20:00"].map((heure) => ({
          heure,
          heure_fin: `${String(parseInt(heure, 10) + 1).padStart(2, "0")}:00`,
          disponible: true,
          statut: "libre",
        }));
      }
      setCreneaux(slots);
    } catch (err) {
      console.error(err);
      setCreneaux(
        ["18:00", "19:00", "20:00"].map((heure) => ({
          heure,
          heure_fin: `${String(parseInt(heure, 10) + 1).padStart(2, "0")}:00`,
          disponible: true,
          statut: "libre",
        }))
      );
    } finally {
      setLoadingSlots(false);
    }
  };

  const hourlyPrice = terrain
    ? Number(fieldFormat === "moitie" ? terrain.prix_moitie : terrain.prix_entier || terrain.prix_heure)
    : 0;
  const total = hourlyPrice * selectedDuration;
  const deposit = calculerMontantAvance(total, terrain?.pourcentage_avance);
  const hasSlot = selectedSlot != null && selectedSlot !== "";

  const selectedDateMeta = dates[selectedDate];
  const slotEnd = selectedSlot ? getEndTime(selectedSlot, selectedDuration) : null;
  const stickyRecap = (() => {
    if (!hasSlot || !selectedSlot || !slotEnd) return null;
    const dayLabel = selectedDateMeta.isTomorrow
      ? "Demain"
      : selectedDateMeta.isToday
        ? "Aujourd'hui"
        : `${selectedDateMeta.weekday} ${selectedDateMeta.day}`;
    return {
      primary: `${dayLabel} ${formatHourLabel(selectedSlot)} – ${formatHourLabel(slotEnd)}`,
      secondary: `Total ${total.toLocaleString("fr-SN")} FCFA · Avance ${deposit.toLocaleString("fr-SN")} FCFA`,
    };
  })();

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

  const clearSlot = () => setSelectedSlot(null);

  const toggleFav = () => {
    if (!terrain?.id) return;
    const next = !fav;
    setFav(next);
    try {
      localStorage.setItem(favKey(terrain.id), next ? "1" : "0");
    } catch {
      /* ignore */
    }
  };

  const getWhatsAppLink = () => {
    if (!terrain?.employe?.whatsapp_number) return null;
    const numero = terrain.employe.whatsapp_number.replace(/[^0-9]/g, "");
    const dateStr = dates[selectedDate];
    const message = encodeURIComponent(
      `Bonjour, je souhaite réserver le terrain ${terrain.nom} le ${dateStr.day} ${dateStr.month} de ${selectedSlot || "..."} à ${selectedSlot ? getEndTime(selectedSlot, selectedDuration) : "..."}. Montant : ${total.toLocaleString()} FCFA.`
    );
    return `https://wa.me/${numero}?text=${message}`;
  };

  if (loading) return <SkeletonFicheTerrain />;

  if (!terrain) {
    return (
      <div className="page-container flex items-center justify-center">
        <div className="text-[var(--color-text-secondary)] text-sm">Terrain non trouvé</div>
      </div>
    );
  }

  const photos = resolveTerrainPhotos(terrain);
  const note = Number(terrain.note || 0);
  const avisCount = Number(terrain.avis_count || terrain.avis?.length || 0);
  const quartier = terrain.adresse || terrain.ville || "";
  const descriptionText = String(terrain.description || "").trim();
  const showDescription =
    descriptionText &&
    !["synthetique", "gazon_synthetique", "gazon_naturel", "naturel", "beton", "béton"].includes(
      descriptionText.toLowerCase()
    );

  const horaire = terrain.horaires?.find((h: any) => {
    const jourMap = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
    const d = new Date(`${dates[selectedDate].isoDate}T12:00:00`);
    return h.jour === jourMap[d.getDay()];
  });

  const sectionCard =
    "mx-4 sm:mx-6 max-w-3xl lg:mx-auto rounded-2xl bg-[#F9FAFB] dark:bg-[var(--surface-2)] border border-gray-100 dark:border-[var(--border)]";

  return (
    <div
      className={`min-h-screen bg-[var(--bg)] page-enter transition-[padding] duration-300 ease-in-out ${
        hasSlot ? "pb-[140px]" : "pb-[120px]"
      }`}
    >      {/* ═══ 1. HEADER VISUEL ═══ */}
      <header>
        <div className="relative h-[260px] sm:h-[300px]">
          <div
            ref={carouselRef}
            className="flex h-full overflow-x-auto snap-x snap-mandatory scrollbar-hide"
            onScroll={(e) => {
              const el = e.currentTarget;
              setPhotoIndex(Math.round(el.scrollLeft / Math.max(el.clientWidth, 1)));
            }}
            onPointerDown={pauseCarouselTemporarily}
            onTouchStart={pauseCarouselTemporarily}
          >
            {photos.map((src, i) => (
              <div key={i} className="relative w-full h-full flex-shrink-0 snap-center">
                <img
                  src={src}
                  alt={`${terrain.nom} ${i + 1}`}
                  className="absolute inset-0 w-full h-full object-cover"
                  draggable={false}
                />
              </div>
            ))}
          </div>
          <div className="absolute inset-0 bg-gradient-to-b from-black/45 via-transparent to-black/50 pointer-events-none" />

          <button
            type="button"
            onClick={() => navigate(-1)}
            className="absolute top-4 left-4 w-11 h-11 rounded-full bg-white/85 backdrop-blur-md flex items-center justify-center shadow-sm"
            aria-label="Retour"
          >
            <ArrowLeft className="w-5 h-5 text-emerald-700" />
          </button>
          <button
            type="button"
            onClick={toggleFav}
            className="absolute top-4 right-4 w-11 h-11 rounded-full bg-white/85 backdrop-blur-md flex items-center justify-center"
            aria-label={fav ? "Retirer des favoris" : "Ajouter aux favoris"}
          >
            <Heart className={`w-5 h-5 ${fav ? "fill-red-500 text-red-500" : "text-slate-600"}`} />
          </button>

          <div className="absolute bottom-0 inset-x-0 px-4 pb-4 pt-10 bg-gradient-to-t from-black/70 to-transparent">
            <h1
              className="text-[22px] sm:text-2xl font-bold text-white leading-tight"
              style={{ fontFamily: "var(--font-display)" }}
            >
              {terrain.nom}
            </h1>
            <div className="mt-1.5 flex items-center gap-2 flex-wrap text-sm text-white/90">
              <span className="inline-flex items-center gap-1">
                <MapPin className="w-3.5 h-3.5 text-emerald-300" />
                {quartier}
                {terrain.ville && terrain.adresse ? ` · ${terrain.ville}` : ""}
              </span>
              {note > 0 && (
                <span className="inline-flex items-center gap-1 font-semibold">
                  <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
                  {note.toFixed(1)}
                  {avisCount > 0 && (
                    <span className="font-normal text-white/70">({avisCount})</span>
                  )}
                </span>
              )}
            </div>
            {(terrain.latitude || terrain.adresse) && (
              <a
                href={
                  terrain.latitude && terrain.longitude
                    ? `https://maps.google.com/?q=${terrain.latitude},${terrain.longitude}`
                    : `https://maps.google.com/?q=${encodeURIComponent(`${quartier} ${terrain.ville || "Dakar"}`)}`
                }
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block mt-2 text-xs font-medium text-emerald-300 underline-offset-2 hover:underline"
              >
                Voir sur Maps
              </a>
            )}
          </div>

          <div className="absolute bottom-[76px] left-0 right-0 flex justify-center gap-1.5 pointer-events-none">
            {photos.map((_, i) => (
              <span
                key={i}
                className={`h-1 rounded-full transition-all ${i === photoIndex ? "w-5 bg-white" : "w-1.5 bg-white/45"}`}
              />
            ))}
          </div>
        </div>
      </header>

      <div className="max-w-3xl mx-auto">
        {/* ═══ 2. SERVICES & ÉQUIPEMENTS ═══ */}
        <div className="border-b border-gray-100 dark:border-[var(--border)]">
          <CommoditesSection
            commodites={terrain.commodites}
            className="px-4 sm:px-6 py-5"
            compact
          />
        </div>

        {/* ═══ 3. TUNNEL DE RÉSERVATION ═══ */}
        <section className={`${sectionCard} mt-4 p-4 sm:p-5`}>
          <h2 className="text-base font-bold text-[var(--color-text-primary)] mb-4" style={{ fontFamily: "var(--font-display)" }}>
            Réserver ce terrain
          </h2>

          {/* Étape A — Date */}
          <div className="pb-4 border-b border-gray-100 dark:border-[var(--border)]">
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)] mb-2">
              1 · Date
            </p>
            <div className="flex gap-2 overflow-x-auto scrollbar-none snap-x">
              {dates.map((d, i) => (
                <button
                  key={d.isoDate}
                  type="button"
                  onClick={() => {
                    setSelectedDate(i);
                    setSelectedSlot(null);
                  }}
                  className={`flex flex-col items-center justify-center w-[58px] min-w-[58px] min-h-[70px] py-2 rounded-xl text-[11px] font-medium snap-start transition-colors ${
                    selectedDate === i
                      ? "bg-emerald-500 text-white shadow-sm"
                      : "bg-white dark:bg-[var(--surface)] border border-gray-200 dark:border-[var(--border)] text-[var(--color-text-secondary)]"
                  }`}
                >
                  <span className="opacity-80">
                    {d.shortLabel || d.weekday}
                  </span>
                  <span className="text-[18px] font-bold mt-0.5">{d.day}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Étape B — Format & Durée */}
          <div className="py-4 border-b border-gray-100 dark:border-[var(--border)] space-y-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)] mb-2">
                2 · Format
              </p>
              <div className="grid grid-cols-2 gap-2">
                {(
                  [
                    ["moitie", "Demi-terrain", terrain.prix_moitie],
                    ["entier", "Terrain entier", terrain.prix_entier || terrain.prix_heure],
                  ] as const
                ).map(([value, label, price]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setFieldFormat(value)}
                    className={`rounded-xl p-3 text-left min-h-[64px] border transition-colors ${
                      fieldFormat === value
                        ? "bg-emerald-500 text-white border-emerald-500"
                        : "bg-white dark:bg-[var(--surface)] border-gray-200 dark:border-[var(--border)]"
                    }`}
                  >
                    <span className="block text-sm font-semibold">{label}</span>
                    <span className="text-[11px] opacity-80">
                      {Number(price || 0).toLocaleString("fr-SN")} FCFA/h
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)] mb-2">
                Durée
              </p>
              <div className="flex gap-2">
                {[1, 2, 3].map((h) => (
                  <button
                    key={h}
                    type="button"
                    onClick={() => setSelectedDuration(h)}
                    className={`flex-1 min-h-[44px] rounded-xl text-sm font-semibold transition-colors ${
                      selectedDuration === h
                        ? "bg-emerald-500 text-white"
                        : "bg-white dark:bg-[var(--surface)] border border-gray-200 dark:border-[var(--border)] text-[var(--color-text-secondary)]"
                    }`}
                  >
                    {h}h
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Étape C — Créneaux */}
          <div ref={slotsSectionRef} id="selection-creneaux" className="pt-4 scroll-mt-28">
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)] mb-2">
              3 · Créneaux disponibles
            </p>
            {loadingSlots ? (
              <div className="grid grid-cols-3 gap-2">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="skeleton h-12 w-full rounded-xl" />
                ))}
              </div>
            ) : creneaux.length === 0 ? (
              <p className="text-center py-5 text-sm text-[var(--color-text-secondary)]">
                Aucun créneau disponible ce jour
              </p>
            ) : (
              <div className="grid grid-cols-3 gap-2">
                {creneaux.map((slot) => {
                  const selected = selectedSlot === slot.heure;
                  const available = Boolean(slot.disponible);
                  const fin = getEndTime(slot.heure, selectedDuration);
                  return (
                    <button
                      key={slot.heure}
                      type="button"
                      disabled={!available}
                      onClick={() => setSelectedSlot(slot.heure)}
                      title={`${formatHourLabel(slot.heure)} – ${formatHourLabel(fin)}`}
                      className={`min-h-[52px] rounded-xl text-sm font-semibold transition-all duration-200 border ${
                        !available
                          ? "bg-gray-100 dark:bg-[var(--surface-3)] text-gray-400 line-through cursor-not-allowed border-transparent"
                          : selected
                            ? "bg-emerald-500 text-white border-emerald-500 shadow-md scale-[1.03]"
                            : "bg-white dark:bg-[var(--surface)] text-emerald-700 dark:text-emerald-400 border-gray-200 dark:border-[var(--border)]"
                      }`}
                    >
                      <span className="block">{formatHourLabel(slot.heure)}</span>
                      <span
                        className={`block text-[10px] font-normal mt-0.5 ${
                          selected ? "text-white/80" : "opacity-60"
                        }`}
                      >
                        – {formatHourLabel(fin)}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </section>

        {/* ═══ 4. INFORMATIONS & RÈGLEMENT ═══ */}
        <section className={`${sectionCard} mt-4 p-4 sm:p-5`}>
          <h2 className="text-base font-bold text-[var(--color-text-primary)] mb-3" style={{ fontFamily: "var(--font-display)" }}>
            Informations & règlement
          </h2>
          <ul className="space-y-3 text-sm text-[var(--color-text-secondary)]">
            {horaire && (
              <li className="flex items-start gap-2">
                <Clock className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                <span>
                  Ouvert {horaire.heure_debut} – {horaire.heure_fin}
                  {selectedDateMeta.isTomorrow ? " demain" : selectedDateMeta.isToday ? " aujourd'hui" : ""}
                </span>
              </li>
            )}
            <li className="flex items-start gap-2">
              <Info className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
              <span>
                La réservation expire après 15 min sans paiement. Annulation gratuite jusqu&apos;à 2h avant le créneau.
              </span>
            </li>
            {showDescription && (
              <li className="pt-1 border-t border-gray-100 dark:border-[var(--border)] text-[var(--color-text-secondary)] leading-relaxed">
                {descriptionText}
              </li>
            )}
          </ul>

          {terrain.employe?.whatsapp_number && (
            <a
              href={getWhatsAppLink() || "#"}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => {
                if (!isAuthenticated) {
                  e.preventDefault();
                  toast.message("Connectez-vous pour réserver");
                  navigate("/login", {
                    state: { from: { pathname: `/terrain/${terrain.id}`, search: "" } },
                  });
                }
              }}
              className="mt-4 flex items-center justify-center gap-2 w-full min-h-[44px] rounded-xl text-white text-sm font-medium"
              style={{ backgroundColor: "#25D366" }}
            >
              <MessageCircle className="w-4 h-4" />
              Contacter le gérant
            </a>
          )}
        </section>

        {/* ═══ 5. AVIS CLIENTS (accordéon) ═══ */}
        {(avisCount > 0 || (terrain.avis && terrain.avis.length > 0)) && (
          <section className={`${sectionCard} mt-4 mb-2 overflow-hidden`}>
            <button
              type="button"
              onClick={() => setAvisOpen((v) => !v)}
              aria-expanded={avisOpen}
              className="w-full flex items-center justify-between gap-3 px-4 sm:px-5 py-3.5 text-left hover:bg-black/[0.02] dark:hover:bg-white/[0.03] transition-colors"
            >
              <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--color-text-primary)] min-w-0">
                <Star className="w-4 h-4 fill-amber-400 text-amber-400 shrink-0" />
                {note > 0 ? note.toFixed(1) : "—"}
                <span className="font-normal text-[var(--color-text-muted)]">
                  ({avisCount || terrain.avis?.length || 0} avis)
                </span>
                <span className="text-[var(--color-text-muted)] font-normal">·</span>
                <span className="text-[var(--color-primary)] font-medium truncate">
                  {avisOpen ? "Masquer les avis" : "Voir les avis clients"}
                </span>
              </span>
              <ChevronDown
                className={`w-5 h-5 text-[var(--color-text-muted)] shrink-0 transition-transform duration-300 ${
                  avisOpen ? "rotate-180" : ""
                }`}
              />
            </button>

            <div
              className="overflow-hidden transition-[max-height] duration-300 ease-in-out"
              style={{ maxHeight: avisOpen ? 2000 : 0 }}
            >
              <div className="px-4 sm:px-5 pb-4 pt-1 border-t border-gray-100 dark:border-[var(--border)] flex flex-col gap-2.5">
                {(terrain.avis || []).map((a: any) => (
                  <article
                    key={a.id}
                    className="bg-white dark:bg-[var(--surface)] border border-gray-100 dark:border-[var(--border)] rounded-xl p-3"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-sm text-[var(--color-text-primary)]">{a.joueur_nom}</span>
                      <span className="inline-flex items-center gap-1 text-xs font-semibold">
                        <Star className="w-3 h-3 fill-amber-400 text-amber-400" />
                        {a.note}
                      </span>
                    </div>
                    {a.commentaire && (
                      <p className="text-xs text-[var(--color-text-secondary)] mt-1.5 leading-relaxed">{a.commentaire}</p>
                    )}
                  </article>
                ))}
              </div>
            </div>
          </section>
        )}
      </div>

      {/* Barre uniquement si créneau sélectionné — sinon non rendue */}
      {hasSlot && stickyRecap && (
        <div
          className="fixed inset-x-0 bottom-16 md:bottom-0 z-50 px-4 py-3 animate-in slide-in-from-bottom-4 fade-in duration-300"
          style={{
            background: "color-mix(in srgb, var(--surface, #fff) 94%, transparent)",
            backdropFilter: "blur(14px)",
            WebkitBackdropFilter: "blur(14px)",
            boxShadow: "0 -4px 16px rgba(0,0,0,0.08)",
            borderTop: "1px solid rgba(0,0,0,0.06)",
          }}
        >
          <div className="max-w-3xl mx-auto flex items-center gap-2.5">
            <button
              type="button"
              onClick={clearSlot}
              className="shrink-0 w-9 h-9 rounded-full bg-gray-100 dark:bg-[var(--surface-2)] text-[var(--color-text-muted)] flex items-center justify-center hover:bg-gray-200 transition-colors"
              aria-label="Annuler la sélection"
            >
              <X className="w-4 h-4" />
            </button>
            <div className="min-w-0 flex-1">
              <p
                className="text-[15px] sm:text-[16px] font-bold text-[var(--color-text-primary)] leading-snug truncate"
                style={{ fontFamily: "var(--font-display)" }}
              >
                {stickyRecap.primary}
              </p>
              <p className="text-[11px] text-[var(--color-text-muted)] mt-0.5 truncate">
                {stickyRecap.secondary}
              </p>
            </div>
            <button
              type="button"
              onClick={goToPayment}
              className="shrink-0 h-12 px-4 rounded-xl text-sm font-bold bg-emerald-500 text-white shadow-[0_4px_16px_rgba(16,185,129,0.4)] hover:bg-emerald-400 active:scale-[0.98] transition-all"
            >
              Valider la réservation
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default FieldDetails;
