# CDC Joueur (extrait texte)

Je vois la répartition. Voici le cahier des charges technique complet pour la partie de Babacar.

CAHIER DES CHARGES TECHNIQUE — BABACAR SENE
Lot B : Joueur · Avance · Géolocalisation · Notifications · Auth
Branche : babacar_sene — Projet TerrainSN

RÈGLES ABSOLUES
																✅ Fichiers autorisés                    ❌ Ne jamais toucher
																─────────────────────────────────────    ──────────────────────────────────
																frontend/src/espaces/joueur/**           espaces/backoffice/pages/gerant/**
																frontend/src/auth/**                     ScannerModal.tsx
																frontend/src/hooks/use-auth.tsx          backend/routes/roles.js (section gérant)
																frontend/src/components/skeletons/**     auditService.js
																frontend/src/lib/api.ts (ses sections)   scoreService.js
																backend/notificationService.js           portefeuille routes
																backend/paytechService.js
																backend/whatsappClient.js
																backend/middleware/auth.js
																backend/index.js (ses sections)

LIVRABLE 1 — SESSION PERSISTANTE JWT (§2 CDC)
Contexte
Le joueur ne doit saisir ses identifiants qu'une seule fois tous les 30 jours. À chaque ouverture de la PWA, la session est restaurée silencieusement.
Backend
Modifier backend/middleware/auth.js — ajouter la logique refresh token :
																// Deux tokens distincts
																// Access token  : JWT 15 minutes, envoyé dans le header Authorization
																// Refresh token : JWT 30 jours, stocké en cookie HTTPOnly uniquement
																
																const jwt = require('jsonwebtoken');
																
																function genererAccessToken(user) {
																  return jwt.sign(
																    { id: user.id, role: user.role, terrain_id: user.terrain_id },
																    process.env.JWT_SECRET,
																    { expiresIn: '15m' }
																  );
																}
																
																function genererRefreshToken(user) {
																  return jwt.sign(
																    { id: user.id },
																    process.env.JWT_REFRESH_SECRET,
																    { expiresIn: '30d' }
																  );
																}
																
																function middlewareAuth(req, res, next) {
																  const token = req.headers.authorization?.split(' ')[1];
																  if (!token) return res.status(401).json({ error: 'Non authentifié' });
																
																  try {
																    req.user = jwt.verify(token, process.env.JWT_SECRET);
																    next();
																  } catch (err) {
																    if (err.name === 'TokenExpiredError') {
																      return res.status(401).json({ error: 'TOKEN_EXPIRE' });
																    }
																    return res.status(401).json({ error: 'Token invalide' });
																  }
																}
Ajouter colonne refresh_token sur users si absente :
																ALTER TABLE users ADD COLUMN refresh_token TEXT;
																ALTER TABLE users ADD COLUMN refresh_token_expire_at DATETIME;
Route POST /api/auth/login — modifier pour retourner les deux tokens :
																// Après vérification mot de passe
																const accessToken = genererAccessToken(user);
																const refreshToken = genererRefreshToken(user);
																
																// Stocker refresh token en DB
																db.prepare(`
																  UPDATE users SET
																    refresh_token = ?,
																    refresh_token_expire_at = datetime('now', '+30 days')
																  WHERE id = ?
																`).run(refreshToken, user.id);
																
																// Refresh token en cookie HTTPOnly
																res.cookie('refresh_token', refreshToken, {
																  httpOnly: true,
																  secure: process.env.NODE_ENV === 'production',
																  sameSite: 'strict',
																  maxAge: 30 * 24 * 60 * 60 * 1000
																});
																
																// Access token dans la réponse JSON
																res.json({
																  accessToken,
																  user: {
																    id: user.id,
																    prenom: user.prenom,
																    nom: user.nom,
																    role: user.role,
																    photo_profil: user.photo_profil
																  }
																});
Route POST /api/auth/refresh — renouvellement silencieux :
																router.post('/api/auth/refresh', (req, res) => {
																  const refreshToken = req.cookies.refresh_token;
																  if (!refreshToken) {
																    return res.status(401).json({ error: 'Session expirée' });
																  }
																
																  try {
																    const payload = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
																
																    const user = db.prepare(`
																      SELECT * FROM users
																      WHERE id = ?
																      AND refresh_token = ?
																      AND refresh_token_expire_at > datetime('now')
																    `).get(payload.id, refreshToken);
																
																    if (!user) {
																      return res.status(401).json({ error: 'Session invalide' });
																    }
																
																    // Vérifier statut utilisateur
																    if (user.statut === 'bloque') {
																      return res.status(403).json({
																        error: 'Ton compte a été suspendu. Contacte le support.'
																      });
																    }
																
																    const newAccessToken = genererAccessToken(user);
																    res.json({ accessToken: newAccessToken });
																
																  } catch (err) {
																    res.clearCookie('refresh_token');
																    return res.status(401).json({ error: 'Session expirée' });
																  }
																});
Route POST /api/auth/logout :
																router.post('/api/auth/logout', middlewareAuth, (req, res) => {
																  db.prepare(`
																    UPDATE users SET refresh_token = NULL,
																    refresh_token_expire_at = NULL WHERE id = ?
																  `).run(req.user.id);
																
																  res.clearCookie('refresh_token');
																  res.json({ success: true });
																});
Variables .env à ajouter :
																JWT_SECRET=
																JWT_REFRESH_SECRET=
Frontend
Modifier frontend/src/hooks/use-auth.tsx :
																// Logique complète de gestion de session
																
																const AuthContext = createContext(null);
																
																export function AuthProvider({ children }) {
																  const [user, setUser] = useState(null);
																  const [accessToken, setAccessToken] = useState(
																    localStorage.getItem('access_token')
																  );
																  const [loading, setLoading] = useState(true);
																
																  // Au démarrage : vérifier si session valide
																  useEffect(() => {
																    restaurerSession();
																  }, []);
																
																  async function restaurerSession() {
																    const tokenStocke = localStorage.getItem('access_token');
																    if (!tokenStocke) {
																      setLoading(false);
																      return;
																    }
																
																    try {
																      // Vérifier si token encore valide
																      const payload = parseJwt(tokenStocke);
																      const maintenant = Date.now() / 1000;
																
																      if (payload.exp > maintenant) {
																        // Token encore valide → restaurer
																        const userInfo = await fetchUserInfo(tokenStocke);
																        setUser(userInfo);
																        setAccessToken(tokenStocke);
																      } else {
																        // Token expiré → tenter refresh silencieux
																        await rafraichirToken();
																      }
																    } catch {
																      await rafraichirToken();
																    } finally {
																      setLoading(false);
																    }
																  }
																
																  async function rafraichirToken() {
																    try {
																      const res = await fetch('/api/auth/refresh', {
																        method: 'POST',
																        credentials: 'include' // envoie le cookie HTTPOnly
																      });
																
																      if (!res.ok) {
																        // Refresh échoué → déconnecter silencieusement
																        deconnecter();
																        return;
																      }
																
																      const { accessToken: newToken } = await res.json();
																      localStorage.setItem('access_token', newToken);
																      setAccessToken(newToken);
																
																      const userInfo = await fetchUserInfo(newToken);
																      setUser(userInfo);
																
																    } catch {
																      deconnecter();
																    }
																  }
																
																  function deconnecter() {
																    localStorage.removeItem('access_token');
																    setUser(null);
																    setAccessToken(null);
																  }
																
																  // Intercepteur axios/fetch : rafraîchir automatiquement si 401 TOKEN_EXPIRE
																  async function requeteAvecAuth(url, options = {}) {
																    const res = await fetch(url, {
																      ...options,
																      headers: {
																        ...options.headers,
																        Authorization: `Bearer ${accessToken}`
																      },
																      credentials: 'include'
																    });
																
																    if (res.status === 401) {
																      const data = await res.json();
																      if (data.error === 'TOKEN_EXPIRE') {
																        await rafraichirToken();
																        // Rejouer la requête avec le nouveau token
																        return fetch(url, {
																          ...options,
																          headers: {
																            ...options.headers,
																            Authorization: `Bearer ${accessToken}`
																          },
																          credentials: 'include'
																        });
																      }
																    }
																
																    return res;
																  }
																
																  return (
																    <AuthContext.Provider value={{
																      user, accessToken, loading,
																      deconnecter, rafraichirToken, requeteAvecAuth,
																      estConnecte: !!user
																    }}>
																      {!loading && children}
																    </AuthContext.Provider>
																  );
																}

LIVRABLE 2 — GÉOLOCALISATION ET FILTRES (§6 CDC)
Backend
Modifier GET /api/terrains dans backend/index.js (section terrains uniquement) :
																// Haversine — calcul distance en km
																function haversine(lat1, lng1, lat2, lng2) {
																  const R = 6371;
																  const dLat = (lat2 - lat1) * Math.PI / 180;
																  const dLng = (lng2 - lng1) * Math.PI / 180;
																  const a =
																    Math.sin(dLat / 2) ** 2 +
																    Math.cos(lat1 * Math.PI / 180) *
																    Math.cos(lat2 * Math.PI / 180) *
																    Math.sin(dLng / 2) ** 2;
																  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
																}
																
																router.get('/api/terrains', (req, res) => {
																  const {
																    lat, lng,
																    date, heure,
																    type,           // demi_terrain | terrain_entier
																    quartier,
																    surface,        // gazon_naturel | gazon_synthetique | beton
																    prix_max,
																    distance_max    // en km, défaut 10
																  } = req.query;
																
																  let terrains = db.prepare(`
																    SELECT t.*,
																      GROUP_CONCAT(tp.url) as photos,
																      COUNT(c.id) as creneaux_libres
																    FROM terrains t
																    LEFT JOIN terrain_photos tp ON tp.terrain_id = t.id AND tp.est_principale = 1
																    LEFT JOIN creneaux c ON c.terrain_id = t.id
																      AND c.statut = 'libre'
																      ${date ? "AND c.date = ?" : ""}
																      ${heure ? "AND c.heure_debut >= ?" : ""}
																      ${type ? "AND c.type = ?" : ""}
																    WHERE t.statut = 'actif'
																      ${quartier ? "AND t.quartier LIKE ?" : ""}
																      ${surface ? "AND t.surface = ?" : ""}
																      ${prix_max ? "AND t.prix_terrain_entier <= ?" : ""}
																    GROUP BY t.id
																    HAVING creneaux_libres > 0
																  `).all(...construireParams(req.query));
																
																  // Calcul distance si coordonnées fournies
																  if (lat && lng) {
																    const distanceMax = parseFloat(distance_max) || 10;
																
																    terrains = terrains
																      .map(t => ({
																        ...t,
																        distance_km: t.latitude && t.longitude
																          ? haversine(
																              parseFloat(lat), parseFloat(lng),
																              t.latitude, t.longitude
																            )
																          : null
																      }))
																      .filter(t =>
																        t.distance_km === null || t.distance_km <= distanceMax
																      )
																      .sort((a, b) => {
																        if (a.distance_km === null) return 1;
																        if (b.distance_km === null) return -1;
																        return a.distance_km - b.distance_km;
																      });
																  }
																
																  res.json({ terrains });
																});
Frontend
Modifier frontend/src/espaces/joueur/Accueil.jsx :
																// Au chargement de la page, demander la géolocalisation
																useEffect(() => {
																  demanderGeolocalisation();
																}, []);
																
																async function demanderGeolocalisation() {
																  if (!navigator.geolocation) {
																    setGeoDisponible(false);
																    return;
																  }
																
																  navigator.geolocation.getCurrentPosition(
																    (position) => {
																      setCoordonnees({
																        lat: position.coords.latitude,
																        lng: position.coords.longitude
																      });
																      setGeoAccordee(true);
																    },
																    () => {
																      // Refus → pas d'erreur affichée, filtre quartier activé
																      setGeoAccordee(false);
																    },
																    { timeout: 5000, maximumAge: 300000 }
																  );
																}
Section "Près de toi" (si géo accordée) :
																{geoAccordee && (
																  <section>
																    <h2>Près de toi 📍</h2>
																    <div className="cards-scroll">
																      {terrains
																        .filter(t => t.distance_km !== null && t.distance_km <= 3)
																        .map(terrain => (
																          <TerrainCard
																            key={terrain.id}
																            terrain={terrain}
																            badge={`À ${terrain.distance_km.toFixed(1)} km`}
																          />
																        ))
																      }
																    </div>
																  </section>
																)}
Filtres disponibles pour le joueur — composant FiltresTerrain.jsx :
																Date souhaitée → date picker natif mobile
																Heure souhaitée → pills : Matin (6h-12h) / Après-midi (12h-18h) / Soir (18h-23h)
																Type → pills : Demi-terrain / Terrain entier
																Quartier → select avec liste des quartiers (si géo refusée, ce filtre est mis en avant)
																Surface → pills : Gazon naturel / Synthétique / Béton
																Prix maximum → slider 5 000 - 100 000 FCFA
																Distance max → slider 1-20 km (visible uniquement si géo accordée)

LIVRABLE 3 — CALCUL AVANCE ET LABELS (§4 CDC)
Règle de calcul
																montant_avance = ARRONDI(prix_choisi × pourcentage_avance / 100)
																montant_restant = prix_choisi - montant_avance
Backend — vérifier paytechService.js
Le montant envoyé à PayTech doit être montant_avance calculé dynamiquement, jamais un montant fixe :
																// paytechService.js
																async function creerPaiement({ reservationId, terrainId, prixChoisi }) {
																  const terrain = db.prepare(
																    `SELECT pourcentage_avance, nom FROM terrains WHERE id = ?`
																  ).get(terrainId);
																
																  const montantAvance = Math.round(
																    prixChoisi * terrain.pourcentage_avance / 100
																  );
																
																  if (process.env.PAYMENT_MODE === 'simulation') {
																    return {
																      success: true,
																      redirect_url: `${process.env.APP_DOMAIN}/simulation/paiement?ref=${reservationId}&montant=${montantAvance}`
																    };
																  }
																
																  const response = await fetch(
																    'https://paytech.sn/api/payment/request-payment',
																    {
																      method: 'POST',
																      headers: {
																        'API_KEY': process.env.PAYTECH_API_KEY,
																        'API_SECRET': process.env.PAYTECH_API_SECRET,
																        'Content-Type': 'application/json'
																      },
																      body: JSON.stringify({
																        item_name: `Avance réservation — ${terrain.nom}`,
																        item_price: montantAvance,
																        currency: 'XOF',
																        ref_command: reservationId,
																        ipn_url: `${process.env.APP_DOMAIN}/webhook/paytech`,
																        success_url: `${process.env.APP_DOMAIN}/reservation/succes`,
																        cancel_url: `${process.env.APP_DOMAIN}/reservation/annule`,
																        env: process.env.NODE_ENV === 'production' ? 'prod' : 'test'
																      })
																    }
																  );
																
																  return await response.json();
																}
Frontend — remplacer tous les labels "acompte" par "avance"
Fichiers à modifier dans espaces/joueur/ :
Reservation.jsx :
																// Affichage du détail prix
																<div className="prix-detail">
																  <div className="ligne">
																    <span>Prix total</span>
																    <span>{formaterPrix(montantTotal)} FCFA</span>
																  </div>
																  <div className="ligne avance">
																    <span>Avance à payer maintenant</span>
																    <span className="montant-avance">
																      {formaterPrix(montantAvance)} FCFA
																    </span>
																  </div>
																  <div className="ligne restant">
																    <span>Reste à payer le jour du match</span>
																    <span>{formaterPrix(montantRestant)} FCFA</span>
																  </div>
																</div>
																
																<button className="btn-primaire" onClick={lancerPaiement}>
																  Payer l'avance — {formaterPrix(montantAvance)} FCFA
																</button>
FicheTerrain.jsx :
																// Sous le prix du créneau
																<p className="info-avance">
																  Avance : {formaterPrix(montantAvance)} FCFA •
																  Reste le jour du match : {formaterPrix(montantRestant)} FCFA
																</p>
Confirmation.jsx et Success.jsx :
																// Récap de paiement
																<div className="recap-paiement">
																  <span>Avance payée</span>
																  <span className="vert">{formaterPrix(montantAvance)} FCFA ✓</span>
																</div>
																<div className="recap-paiement">
																  <span>À régler sur place</span>
																  <span>{formaterPrix(montantRestant)} FCFA</span>
																</div>
Rechercher et remplacer dans tous les fichiers joueur :
																"acompte" → "avance"         (labels visibles)
																"Acompte" → "Avance"         (titres)
																"ACOMPTE" → "AVANCE"         (constantes UI)
																
																Ne pas renommer les colonnes DB ni les variables backend
																(montant_acompte en DB reste tel quel pour ne pas casser Mohamed)
																Uniquement les textes affichés à l'écran

LIVRABLE 4 — TEMPLATES WHATSAPP (§8 CDC)
Dans backend/notificationService.js
Implémenter ou corriger ces 5 fonctions. Le client WhatsApp (whatsappClient.js) est déjà initialisé, utiliser envoyerWhatsApp(telephone, message) existant.
Fonction utilitaire de formatage :
																function formaterDate(dateStr) {
																  return new Date(dateStr).toLocaleDateString('fr-SN', {
																    weekday: 'long', day: 'numeric', month: 'long'
																  });
																}
																
																function formaterHeure(heureStr) {
																  return heureStr.substring(0, 5);
																}
																
																function formaterMontant(montant) {
																  return montant.toLocaleString('fr-SN') + ' FCFA';
																}
Template 1 — OTP inscription :
																async function envoyerOTP({ telephone, prenom, code }) {
																  await envoyerWhatsApp(telephone,
																    `👋 Salut ${prenom} ! Bienvenue sur TerrainSN.\n\n` +
																    `Ton code de confirmation : *${code}*\n` +
																    `Il est valable 10 minutes. Ne le partage avec personne 🔒`
																  );
																}
Template 2 — Confirmation réservation avec QR code :
																async function envoyerConfirmation(reservationId) {
																  const data = db.prepare(`
																    SELECT r.code_reservation, r.montant_avance, r.montant_restant,
																           r.qr_code_url,
																           u.prenom, u.telephone,
																           t.nom as terrain_nom, t.quartier, t.latitude, t.longitude,
																           c.date, c.heure_debut, c.heure_fin
																    FROM reservations r
																    JOIN users u ON u.id = r.joueur_id
																    JOIN creneaux c ON c.id = r.creneau_id
																    JOIN terrains t ON t.id = c.terrain_id
																    WHERE r.id = ?
																  `).get(reservationId);
																
																  const lienMaps = data.latitude && data.longitude
																    ? `https://maps.google.com/?q=${data.latitude},${data.longitude}`
																    : null;
																
																  const message =
																    `⚽ C'est confirmé ${data.prenom} !\n\n` +
																    `Ton terrain t'attend :\n` +
																    `📍 ${data.terrain_nom} — ${data.quartier}\n` +
																    `🗓️ ${formaterDate(data.date)} à ${formaterHeure(data.heure_debut)}\n` +
																    `🏷️ Code : *${data.code_reservation}*\n\n` +
																    (lienMaps ? `🗺️ Voir sur Maps : ${lienMaps}\n\n` : '') +
																    `💰 Avance payée : ${formaterMontant(data.montant_avance)}\n` +
																    `💵 À régler sur place : ${formaterMontant(data.montant_restant)}\n\n` +
																    `📌 Viens *30 minutes avant* avec ce QR code, c'est lui qui ouvre les portes 😄\n` +
																    `Le gérant va le scanner pour valider ta présence.\n\n` +
																    `⚠️ Ce QR code est à usage unique — ne le partage pas.`;
																
																  // Envoyer le message texte
																  await envoyerWhatsApp(data.telephone, message);
																
																  // Envoyer le QR code en image si disponible
																  if (data.qr_code_url) {
																    await envoyerImageWhatsApp(
																      data.telephone,
																      `${process.env.APP_DOMAIN}${data.qr_code_url}`,
																      `QR Code — ${data.code_reservation}`
																    );
																  }
																}
Template 3 — Lien paiement (réservation par téléphone) :
																async function envoyerLienPaiement(reservationId) {
																  const data = db.prepare(`
																    SELECT r.montant_avance, r.montant_restant,
																           u.prenom, u.telephone,
																           t.nom as terrain_nom,
																           c.date, c.heure_debut,
																           p.lien_paytech
																    FROM reservations r
																    JOIN users u ON u.id = r.joueur_id
																    JOIN creneaux c ON c.id = r.creneau_id
																    JOIN terrains t ON t.id = c.terrain_id
																    LEFT JOIN paiements p ON p.reservation_id = r.id
																    WHERE r.id = ?
																  `).get(reservationId);
																
																  await envoyerWhatsApp(data.telephone,
																    `👋 Salut ${data.prenom} !\n\n` +
																    `Le gérant de *${data.terrain_nom}* a enregistré ta résa ` +
																    `pour le ${formaterDate(data.date)} à ${formaterHeure(data.heure_debut)}.\n\n` +
																    `Pour confirmer ta place, paie ton avance de ` +
																    `*${formaterMontant(data.montant_avance)}* ici :\n` +
																    `👉 ${data.lien_paytech}\n\n` +
																    `Le reste (*${formaterMontant(data.montant_restant)}*) ` +
																    `tu l'amènes le jour du match, pas de stress 😊\n\n` +
																    `⚠️ Ce lien est valable *2 heures*. Après ça, la place repart.`
																  );
																}
Template 4 — Remboursement créneau pris :
																async function envoyerRemboursement(reservationId) {
																  const data = db.prepare(`
																    SELECT u.prenom, u.telephone,
																           t.nom as terrain_nom, t.id as terrain_id,
																           c.date
																    FROM reservations r
																    JOIN users u ON u.id = r.joueur_id
																    JOIN creneaux c ON c.id = r.creneau_id
																    JOIN terrains t ON t.id = c.terrain_id
																    WHERE r.id = ?
																  `).get(reservationId);
																
																  // Trouver 3 créneaux libres du même terrain
																  const creneauxDispo = db.prepare(`
																    SELECT date, heure_debut, type FROM creneaux
																    WHERE terrain_id = ? AND statut = 'libre'
																    AND date >= date('now')
																    ORDER BY date ASC, heure_debut ASC
																    LIMIT 3
																  `).all(data.terrain_id);
																
																  const lienDispo =
																    `${process.env.APP_DOMAIN}/terrains/${data.terrain_id}`;
																
																  await envoyerWhatsApp(data.telephone,
																    `😕 Oups ${data.prenom}...\n\n` +
																    `Quelqu'un a grillé la priorité sur ce créneau à la ` +
																    `dernière seconde. Ton paiement sera remboursé sous 24h, promis.\n\n` +
																    `Mais t'inquiète, voilà ce qui est encore dispo :\n` +
																    `👉 ${lienDispo}\n\n` +
																    `On t'en trouve un autre 💪`
																  );
																}
Template 5 — Reversement solde gérant :
																async function envoyerReversementGerant({
																  telephone, nom, montantReverse,
																  montantCommission, soldeTotal, codeReservation
																}) {
																  await envoyerWhatsApp(telephone,
																    `💰 Virement reçu !\n\n` +
																    `Réservation *${codeReservation}* confirmée.\n` +
																    `Commission plateforme : ${formaterMontant(montantCommission)}\n` +
																    `*Crédité sur ton compte : ${formaterMontant(montantReverse)}*\n\n` +
																    `Solde disponible : *${formaterMontant(soldeTotal)}*`
																  );
																}
Exporter toutes les fonctions :
																module.exports = {
																  envoyerOTP,
																  envoyerConfirmation,
																  envoyerLienPaiement,
																  envoyerRemboursement,
																  envoyerReversementGerant,
																  // Fonctions existantes conservées telles quelles
																};

LIVRABLE 5 — SKELETON LOADERS (§ CDC)
Créer frontend/src/components/skeletons/ avec ces composants :
SkeletonTerrainCard.jsx :
																// Simule une card terrain pendant le chargement
																<div className="skeleton-card">
																  <div className="skeleton-image" />      {/* 180px hauteur */}
																  <div className="skeleton-content">
																    <div className="skeleton-line large" />  {/* nom terrain */}
																    <div className="skeleton-line small" />  {/* quartier */}
																    <div className="skeleton-line medium" /> {/* prix */}
																    <div className="skeleton-btn" />         {/* bouton réserver */}
																  </div>
																</div>
SkeletonFicheTerrain.jsx : hero photo + pills infos + grille créneaux
SkeletonMesReservations.jsx : 3 cards avec bordure gauche grise
SkeletonProfil.jsx : cercle photo + lignes formulaire
CSS animation skeleton (dans index.css) :
																@keyframes shimmer {
																  0% { background-position: -200% 0; }
																  100% { background-position: 200% 0; }
																}
																
																.skeleton-line, .skeleton-image, .skeleton-btn, .skeleton-card {
																  background: linear-gradient(
																    90deg,
																    var(--color-surface-2) 25%,
																    var(--color-border) 50%,
																    var(--color-surface-2) 75%
																  );
																  background-size: 200% 100%;
																  animation: shimmer 1.5s infinite;
																  border-radius: var(--radius-sm);
																}
Utilisation dans les pages joueur :
																// Remplacer tous les spinners centraux par les skeletons
																{loading ? (
																  <>
																    <SkeletonTerrainCard />
																    <SkeletonTerrainCard />
																    <SkeletonTerrainCard />
																  </>
																) : (
																  terrains.map(t => <TerrainCard key={t.id} terrain={t} />)
																)}

CRITÈRES D'ACCEPTATION COMPLETS
																SESSION
																[ ] Joueur reste connecté 30 jours sans resaisir ses identifiants
																[ ] Ouverture PWA → session restaurée en moins de 500ms silencieusement
																[ ] Token expiré → refresh automatique invisible pour l'utilisateur
																[ ] Déconnexion → cookie supprimé + localStorage vidé
																[ ] Compte bloqué → message clair à la tentative de refresh
																
																GÉOLOCALISATION
																[ ] Si géo accordée → terrains triés par distance croissante
																[ ] Badge distance "À X.X km" visible sur chaque card
																[ ] Si géo refusée → filtre quartier mis en avant, aucun message d'erreur
																[ ] Distance calculée côté backend avec Haversine
																[ ] Filtre distance_max fonctionnel
																
																AVANCE
																[ ] Aucun libellé "acompte" visible côté joueur
																[ ] Montant avance = pourcentage exact du prix choisi
																[ ] Montant restant affiché clairement sur toutes les pages concernées
																[ ] PayTech reçoit le montant_avance calculé dynamiquement
																[ ] Colonnes DB non renommées (compatibilité avec le travail de Mohamed)
																
																WHATSAPP
																[ ] OTP reçu en moins de 30 secondes après inscription
																[ ] Confirmation avec QR code en image reçue après paiement
																[ ] Lien paiement reçu pour réservation manuelle gérant
																[ ] Message remboursement avec lien créneaux dispo reçu en cas de conflit
																[ ] Message reversement gérant reçu après confirmation
																
																SKELETONS
																[ ] Aucun spinner centré dans l'espace joueur
																[ ] Skeleton visible pendant chaque chargement de liste
																[ ] Transition skeleton → contenu fluide sans flash blanc
																
																COORDINATION AVEC MOHAMED
																[ ] Colonnes DB non modifiées (montant_acompte reste tel quel)
																[ ] Aucun fichier touché dans espaces/backoffice/pages/gerant/**
																[ ] statut match_joue utilisé tel que défini par Mohamed
																[ ] PR soumise avant merge sur main

VARIABLES .ENV REQUISES
																JWT_SECRET=
																JWT_REFRESH_SECRET=
																PAYTECH_API_KEY=
																PAYTECH_API_SECRET=
																APP_DOMAIN=
																PAYMENT_MODE=simulation
																NODE_ENV=development

ORDRE DE LIVRAISON
																Semaine 1
																  [ ] Formule avance + remplacement labels joueur
																  [ ] Vérification paytechService.js montant dynamique
																
																Semaine 2
																  [ ] Géolocalisation Haversine backend
																  [ ] Filtres terrains frontend
																  [ ] Templates WhatsApp 5 fonctions
																
																Semaine 3
																  [ ] Session JWT + refresh token HTTPOnly
																  [ ] Skeleton loaders toutes pages joueur
																  [ ] Recette croisée avec Mohamed

Babacar a tout ce qu'il lui faut pour travailler sans bloquer Mohamed et sans risque de conflit. 🚀
