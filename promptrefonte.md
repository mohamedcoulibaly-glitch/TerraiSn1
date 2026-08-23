---

>
>
> ---
>
> > **Rôle** Tu es un designer UI/UX et développeur frontend senior expert React.js, TypeScript et Tailwind CSS. Tu améliores l'espace propriétaire d'une PWA de réservation de terrains de football au Sénégal. Le propriétaire est un superviseur, pas un opérateur. Son interface doit lui donner confiance, lisibilité et tranquillité d'esprit sans jamais lui donner accès aux actions réservées au gérant ou au super admin. Aucune modification de logique backend sans validation. Montre chaque fichier complet et attends ma validation avant de continuer.
> >
> > ---
> >
> > **Règle absolue** Ne toucher à aucune logique existante (paiement, WhatsApp, scan QR, auth, SSE). Uniquement le JSX, le routing, les composants visuels et les classes Tailwind. Chaque phase attend ma validation.
> >
> > ---
> >
> > **PHASE 1 — Audit**
> >
> > Scanne `espaces/backoffice/pages/proprietaire/**` et liste :
> >
> > - Tous les composants et pages existants
> > - Les actions encore présentes dans la fiche `terrain/:id` qui contredisent la posture lecture seule
> > - Les KPI calculés localement dans la fiche qui ne sont pas alignés avec `/api/proprietaire/finances`
> > - Les imports depuis `gerant-app` ou l'espace gérant dans les pages proprio
> > - Les query params utilisés à la place de routes dédiées
> > - Ce qui fonctionne bien et ne doit pas être touché
> >
> > Produis le rapport et attends ma validation.
> >
> > ---
> >
> > **PHASE 2 — Système de design propriétaire**
> >
> > Créer des variables CSS dédiées à l'espace propriétaire dans `index.css`. Ne pas réutiliser `--g-*` du gérant :
> >
> > ```css
> > .proprio-app {
> >   /* Identité visuelle : sobre, premium, confiance */
> >   /* Inspiré d'un tableau de bord financier — pas d'un outil opérationnel */
> >
> >   --p-bg:              #F4F7FB;
> >   --p-surface:         #FFFFFF;
> >   --p-surface-2:       #EEF2F8;
> >   --p-surface-3:       #E2E8F4;
> >   --p-border:          #D8E0EE;
> >   --p-border-strong:   #B8C4DA;
> >
> >   --p-text:            #0D1B2A;
> >   --p-text-2:          #3D5166;
> >   --p-muted:           #7A8FA6;
> >
> >   /* Accent principal — bleu nuit confiance */
> >   --p-primary:         #1E40AF;
> >   --p-primary-light:   #3B82F6;
> >   --p-primary-glow:    rgba(30,64,175,0.10);
> >
> >   /* Accent secondaire — or supervision */
> >   --p-gold:            #D97706;
> >   --p-gold-light:      #F59E0B;
> >   --p-gold-glow:       rgba(217,119,6,0.10);
> >
> >   /* Statuts santé gérant */
> >   --p-optimal:         #059669;
> >   --p-optimal-bg:      rgba(5,150,105,0.10);
> >   --p-attention:       #D97706;
> >   --p-attention-bg:    rgba(217,119,6,0.10);
> >   --p-verifier:        #DC2626;
> >   --p-verifier-bg:     rgba(220,38,38,0.10);
> >
> >   /* Alertes */
> >   --p-alert-bg:        rgba(220,38,38,0.06);
> >   --p-alert-border:    rgba(220,38,38,0.20);
> >
> >   /* Navigation */
> >   --p-nav-bg:          rgba(255,255,255,0.95);
> >   --p-nav-border:      rgba(216,224,238,0.8);
> >   --p-nav-active:      #1E40AF;
> >
> >   /* Cards */
> >   --p-shadow:          0 2px 12px -2px rgba(13,27,42,0.07);
> >   --p-shadow-md:       0 4px 20px -4px rgba(13,27,42,0.10);
> >   --p-shadow-lg:       0 8px 32px -4px rgba(13,27,42,0.14);
> >
> >   /* Live indicator */
> >   --p-live:            #059669;
> > }
> >
> > .dark .proprio-app {
> >   --p-bg:              #070D14;
> >   --p-surface:         #0F1923;
> >   --p-surface-2:       #162233;
> >   --p-surface-3:       #1E2D40;
> >   --p-border:          #1F2D3D;
> >   --p-border-strong:   #2A3F55;
> >   --p-text:            #F0F6FF;
> >   --p-text-2:          #8BAFC8;
> >   --p-muted:           #4A6278;
> >   --p-nav-bg:          rgba(7,13,20,0.95);
> >   --p-nav-border:      rgba(31,45,61,0.8);
> >   --p-shadow:          0 2px 12px -2px rgba(0,0,0,0.30);
> >   --p-shadow-md:       0 4px 20px -4px rgba(0,0,0,0.45);
> > }
> >
> > ```
> >
> > Ajouter la classe `proprio-app` sur le wrapper `ProprietaireChrome`. Supprimer tout import ou usage de `gerant-app` dans l'espace propriétaire.
> >
> > ---
> >
> > **PHASE 3 — Navigation : corriger les routes et le chrome**
> >
> > **Transformer la vue Terrains de query param en route dédiée :**
> >
> > ```
> > AVANT (cassé)
> >   /backoffice/proprietaire?view=terrains
> >
> > APRÈS (propre)
> >   /backoffice/proprietaire/terrains
> >
> > ```
> >
> > Mettre à jour `AppRouter.tsx` avec cette nouvelle route. Mettre à jour les liens internes. Ne plus utiliser de query param pour la navigation principale.
> >
> > **Refondre** `ProprietaireChrome.tsx` **— navigation 4 onglets :**
> >
> > ```tsx
> > const TABS = [
> >   {
> >     id: 'dashboard',
> >     label: 'Aperçu',
> >     icon: LayoutDashboard,
> >     route: '/backoffice/proprietaire'
> >   },
> >   {
> >     id: 'revenus',
> >     label: 'Revenus',
> >     icon: TrendingUp,
> >     route: '/backoffice/proprietaire/revenus'
> >   },
> >   {
> >     id: 'sante',
> >     label: 'Santé',
> >     icon: ShieldCheck,
> >     route: '/backoffice/proprietaire/sante'
> >   },
> >   {
> >     id: 'terrains',
> >     label: 'Terrains',
> >     icon: MapPin,
> >     route: '/backoffice/proprietaire/terrains'
> >   },
> > ];
> >
> > ```
> >
> > **Header du chrome :**
> >
> > ```
> > Fond var(--p-surface)
> > Bordure bottom var(--p-border)
> > Gauche : "Bonjour [Prénom] 👋" 16px bold var(--p-text)
> >           Sous-titre : nombre de terrains en var(--p-muted) 12px
> > Droite :
> >   Indicateur Live SSE :
> >     Point vert animé pulse + texte "En direct" 11px var(--p-optimal)
> >     Si SSE déconnecté → point rouge + "Hors ligne"
> >   Avatar photo circulaire 36px → /profil/proprietaire
> >
> > Desktop : sidebar 220px fond var(--p-surface) bordure right
> > Mobile : bottom nav 56px + safe-area
> >
> > ```
> >
> > ---
> >
> > **PHASE 4 — Dashboard Aperçu : refonte complète**
> >
> > Le dashboard doit donner en un coup d'œil l'état du mois sans que le proprio cherche. Garder tous les appels API existants, uniquement refaire le JSX :
> >
> > ```
> > SECTION 1 — ALERTES PROACTIVES (nouveau, en haut si alertes actives)
> >
> >   Si score santé d'un terrain est rouge (< 50) :
> >     Card alerte fond var(--p-alert-bg), bordure var(--p-alert-border)
> >     Icône AlertTriangle rouge
> >     "⚠️ [Nom terrain] — Score de confiance bas ce mois"
> >     "Pense à en parler avec [Prénom gérant] 😊"
> >     Bouton "Voir la santé" → /backoffice/proprietaire/sante
> >
> >   Si taux d'occupation < 40% sur le mois :
> >     Card alerte orange
> >     "📉 [Nom terrain] — Occupation faible ce mois ([X]%)"
> >     Bouton "Voir les revenus" → /backoffice/proprietaire/revenus
> >
> >   Si aucune alerte → section absente du DOM
> >   Les alertes sont calculées depuis les données déjà chargées
> >   Pas d'appel API supplémentaire
> >
> > SECTION 2 — PILULES TERRAINS (si > 1 terrain)
> >
> >   Scroll horizontal
> >   Pills : "Tous" + 1 pill par terrain
> >   Pill actif : fond var(--p-primary), texte blanc
> >   Pill inactif : fond var(--p-surface-2), texte var(--p-muted)
> >   Sélection → recalcul KPI côté client depuis terrainStats[]
> >   Si 1 seul terrain → section absente
> >
> > SECTION 3 — KPI 2×2 (mois en cours, alignés avec /api/proprietaire/stats)
> >
> >   Grille 2 colonnes, gap 10px
> >   Chaque card : fond var(--p-surface), shadow var(--p-shadow)
> >   border-radius 16px, padding 16px
> >
> >   Card 1 — CA du mois
> >     Icône TrendingUp var(--p-primary) dans cercle --p-primary-glow
> >     Chiffre : X FCFA en 22px --font-display var(--p-text) bold
> >     Label : "Chiffre d'affaires" 11px var(--p-muted)
> >     Delta vs mois précédent : +X% vert ou -X% rouge 11px
> >       (calculé depuis les données existantes)
> >
> >   Card 2 — Occupation
> >     Icône Activity var(--p-gold) dans cercle --p-gold-glow
> >     Chiffre : X% en 22px --font-display
> >     Label : "Taux d'occupation" 11px var(--p-muted)
> >     Mini barre de progression colorée dessous
> >       < 40% → rouge | 40-70% → orange | > 70% → vert
> >
> >   Card 3 — Matchs joués
> >     Icône CheckCircle var(--p-optimal) dans cercle --p-optimal-bg
> >     Chiffre : X / Y en 22px (joués / total résas)
> >     Label : "Matchs ce mois" 11px var(--p-muted)
> >
> >   Card 4 — Top terrain (si > 1 terrain, sinon remplacer)
> >     Si > 1 terrain :
> >       Nom du terrain le plus rentable
> >       CA en vert var(--p-optimal)
> >       Label : "Meilleur terrain" 11px var(--p-muted)
> >     Si 1 seul terrain :
> >       Remplacer par card "À venir" :
> >       Nombre de réservations confirmées à venir
> >       Label : "Résas confirmées" 11px var(--p-muted)
> >
> > SECTION 4 — SANTÉ GÉRANT CONDENSÉE
> >
> >   Titre "Tes gérants ce mois" 14px semi-bold var(--p-text)
> >   Lien "Voir détails →" à droite → /backoffice/proprietaire/sante
> >
> >   Pour chaque terrain (max 4, après filtre terrain actif) :
> >     Ligne horizontale compacte height 52px
> >     fond var(--p-surface), border-radius 12px, shadow var(--p-shadow)
> >     padding 12px 16px
> >
> >     Gauche :
> >       Nom du terrain 13px semi-bold var(--p-text)
> >       Gérant : [Prénom] 11px var(--p-muted)
> >
> >     Centre :
> >       Scans : "X/Y matchs validés" 12px var(--p-text-2)
> >
> >     Droite :
> >       Badge santé pill arrondi 12px font-semibold :
> >         Score > 75 → fond var(--p-optimal-bg), texte var(--p-optimal), "Optimal ✓"
> >         Score 50-75 → fond var(--p-attention-bg), texte var(--p-attention), "Attention"
> >         Score < 50 → fond var(--p-verifier-bg), texte var(--p-verifier), "À vérifier"
> >       Lien "→" → onglet Santé filtré sur ce terrain
> >
> >   Si 0 terrain → illustration + "Aucun terrain associé pour le moment"
> >
> > SECTION 5 — FIL D'ACTIVITÉ RÉCENT (nouveau)
> >
> >   Titre "Activité récente" 14px semi-bold var(--p-text)
> >   Les 5 dernières actions depuis activite_gerant tous terrains confondus
> >
> >   Chaque ligne :
> >     Icône selon action (même mapping que vue Santé)
> >     Texte en langage simple :
> >       reservation_creee → "Nouvelle réservation créée"
> >       qr_scanne → "Match validé ✅"
> >       reservation_annulee → "Réservation annulée"
> >       creneau_cree → "Nouveau créneau ajouté"
> >       creneau_supprime → "Créneau supprimé"
> >     Nom du terrain en var(--p-muted) 11px
> >     Heure relative : "il y a 5 min" 11px var(--p-muted) à droite
> >
> >   Lien "Voir tout" → onglet Santé (fil complet)
> >   Mis à jour par SSE en temps réel
> >
> > INDICATEUR LIVE
> >   En haut à droite du dashboard
> >   Point vert animé + "En direct"
> >   Si poll 8s → afficher "Mis à jour il y a Xs" discret
> >
> > ```
> >
> > ---
> >
> > **PHASE 5 — Page Revenus : aligner avec le moteur finances**
> >
> > La page Revenus doit parler exactement la même langue que les KPI du Dashboard. Aucune donnée locale recalculée :
> >
> > ```
> > SOURCE UNIQUE : GET /api/proprietaire/finances?periode=&terrain_id=
> > Les KPI de cette page = exactement les mêmes champs
> > que GET /api/proprietaire/stats mais filtrables par période
> >
> > FILTRES (2 lignes de pills)
> >   Ligne 1 — Terrains (si > 1) : Tous + 1 pill par terrain
> >   Ligne 2 — Périodes : Aujourd'hui | Cette semaine | Ce mois | Cette année
> >   Changement filtre → AJAX, skeleton loaders, pas de rechargement page
> >
> > KPI 2×2 (identiques au Dashboard, même calcul)
> >   Card 1 : Montant total encaissé
> >   Card 2 : Avances reçues
> >   Card 3 : Matchs joués
> >   Card 4 : À venir (résas confirmées non encore jouées)
> >
> >   Delta entre périodes si possible :
> >     "Cette semaine vs semaine dernière : +15%"
> >
> > MENTION ABONNEMENTS / TOURNOIS
> >   Si des encaissements de type 'abonnement' ou 'tournoi' existent :
> >     Card info bleue : "Inclut X FCFA d'abonnements/tournois"
> >   Sinon :
> >     Phrase discrète en var(--p-muted) :
> >     "Les abonnements et tournois ne sont pas encore pris en compte"
> >
> > GRAPHIQUE (recharts)
> >   Barres var(--p-primary)
> >   Axe X :
> >     Aujourd'hui → par heure (6h, 7h, 8h...)
> >     Cette semaine → par jour (Lun, Mar...)
> >     Ce mois → par semaine (S1, S2, S3, S4)
> >     Cette année → par mois (Jan, Fév...)
> >   Tooltip : montant + nombre de matchs au survol
> >   Si > 1 terrain et vue "Tous" : barres empilées par terrain
> >     (couleur différente par terrain, légende en dessous)
> >
> > HISTORIQUE DES ENCAISSEMENTS
> >   Liste paginée (10 par page)
> >   Chaque ligne :
> >     Date + heure | Nom joueur | Nom terrain (si vue Tous)
> >     Montant avance en var(--p-optimal) bold
> >     Badge statut : Joué ✓ | Confirmé | En attente
> >   Aucune colonne commission, aucune colonne reversement
> >   Filtre de recherche par numéro de téléphone joueur
> >
> > SUPPRIMER COMPLÈTEMENT
> >   Tout import depuis gerant-app
> >   Toute référence à FinancesView gérant
> >   Toute mention reversement, commission, solde gérant
> >
> > ```
> >
> > ---
> >
> > **PHASE 6 — Page Santé : améliorer la lisibilité et le fil d'activité**
> >
> > ```
> > HEADER
> >   Titre "Santé opérationnelle" 18px --font-display var(--p-text)
> >   Sous-titre "Basé sur les 60 derniers jours" 12px var(--p-muted)
> >   Pilules terrains si > 1 (scroll horizontal)
> >   Changement terrain → AJAX, recalcul immédiat
> >
> > SECTION SCORE (en haut, bien visible)
> >   Cercle SVG progress animé au chargement (stroke-dasharray)
> >   Score en grand --font-display au centre (ex: "88")
> >   "/100" en 14px var(--p-muted) dessous
> >   Couleur cercle selon score
> >   Phrase sous le cercle :
> >     > 75 : "Tout va bien 👍"
> >     50-75 : "Pense à en parler avec ton gérant 😊"
> >     < 50 : "On te conseille de contacter ton gérant"
> >   Aucune explication du calcul affichée
> >
> > 3 CARDS STATS (grille responsive)
> >
> >   Card 1 — Matchs validés
> >     "X sur Y matchs scannés ce mois"
> >     Barre progression colorée
> >     > 75% → var(--p-optimal)
> >     50-75% → var(--p-attention)
> >     < 50% → var(--p-verifier)
> >
> >   Card 2 — Non scannés
> >     Nombre en orange si > 0, vert si 0
> >     Bouton "Voir la liste" → bottom sheet avec :
> >       Nom joueur | Date | Heure | Code TF-XXXXXX
> >       Lecture seule uniquement
> >
> >   Card 3 — Annulations
> >     Nombre d'annulations sur 60 jours
> >     Toujours en gris neutre, jamais en rouge
> >     Label : "Sur les 60 derniers jours"
> >
> > GRAPHIQUE ÉVOLUTION DU SCORE
> >   6 barres (6 derniers mois)
> >   Couleur de chaque barre selon le score du mois :
> >     > 75 → var(--p-optimal)
> >     50-75 → var(--p-attention)
> >     < 50 → var(--p-verifier)
> >   Tooltip : score + mois au survol
> >   Si moins de 2 mois de données :
> >     Masquer le graphique, afficher :
> >     "Le graphique sera disponible après 2 mois d'activité 😊"
> >
> > FIL D'ACTIVITÉ GÉRANT (amélioré)
> >   Titre "Ce que fait ton gérant"
> >   Sous-titre discret : "Activité en temps réel" + point vert SSE
> >
> >   Filtre quick pills :
> >     Tout | Scans QR | Réservations | Créneaux
> >
> >   Liste des 20 dernières actions (paginée)
> >   Chaque ligne :
> >     Icône colorée selon action :
> >       qr_scanne → CheckCircle vert
> >       reservation_creee → CalendarPlus bleu
> >       reservation_annulee → X orange
> >       creneau_cree → Plus bleu clair
> >       creneau_supprime → Trash orange
> >     Label en langage simple (voir mapping Phase 4)
> >     Heure relative "il y a X min" var(--p-muted)
> >
> >   Nouvelles actions via SSE → apparition en haut avec
> >   animation fadeSlideDown (opacity 0 → 1, translateY -8px → 0)
> >
> > EMPTY STATE
> >   Si 0 données (terrain récent) :
> >     Illustration simple centrée
> >     "Pas encore assez de données 😊"
> >     "Le tableau de bord se remplit au fur et à mesure des réservations."
> >
> > ```
> >
> > ---
> >
> > **PHASE 7 — Page Terrains : route dédiée et lecture seule stricte**
> >
> > ```
> > ROUTE : /backoffice/proprietaire/terrains (nouvelle route dédiée)
> >
> > HEADER
> >   Titre "Mes terrains" 18px --font-display
> >   Nombre de terrains en badge var(--p-muted)
> >
> > LISTE DES TERRAINS (une card par terrain)
> >   fond var(--p-surface), border-radius 16px, shadow var(--p-shadow)
> >   padding 16px
> >
> >   LIGNE 1
> >     Photo terrain (miniature 56px, border-radius 8px) à gauche
> >     Nom terrain 15px semi-bold var(--p-text)
> >     Ville / Quartier 12px var(--p-muted)
> >     Badge Ouvert/Fermé à droite :
> >       Ouvert → fond var(--p-optimal-bg), texte var(--p-optimal)
> >       Fermé → fond var(--p-surface-2), texte var(--p-muted)
> >
> >   LIGNE 2 — Gérant
> >     Icône User 14px var(--p-muted)
> >     "Gérant : [Prénom Nom]" 13px var(--p-text-2)
> >     Si aucun gérant associé :
> >       Badge orange "Aucun gérant assigné"
> >       → Cette info remonte au super admin automatiquement
> >
> >   LIGNE 3 — Tarifs (lecture seule)
> >     Pills tarifs en lecture :
> >       "Entier : X FCFA / h"
> >       "Demi : X FCFA / h"
> >     Si tarifs dynamiques actifs :
> >       Badge info bleu "Tarifs variables selon horaire"
> >
> >   LIGNE 4 — Mini KPI du terrain
> >     Occupation du mois | Matchs joués | CA du mois
> >     En 3 blocs côte à côte, lecture seule
> >     Données depuis /api/proprietaire/stats filtré par terrain
> >
> >   Aucun bouton modifier, supprimer, créer, activer/désactiver
> >   Aucun lien vers /terrain/:id
> >   Carte entière non cliquable
> >
> > EMPTY STATE
> >   Si 0 terrain associé :
> >     "Aucun terrain associé à ton compte pour le moment.
> >      Contacte l'administration pour en ajouter un."
> >
> > ```
> >
> > ---
> >
> > **PHASE 8 — Supprimer et neutraliser la fiche terrain/:id**
> >
> > La fiche `/backoffice/proprietaire/terrain/:id` contient des actions contradictoires avec la posture superviseur. La neutraliser sans la supprimer (pour éviter les liens externes cassés) :
> >
> > ```
> > SUPPRIMER de la fiche terrain/:id :
> >   Bouton "Éditer le terrain"
> >   Bouton "Activer / Désactiver"
> >   Bouton "Supprimer le terrain"
> >   Tous les formulaires CRUD gérant
> >   Le formulaire de grille tarifaire
> >   Tout bouton de soumission ou de modification
> >
> > GARDER en lecture seule :
> >   Les infos du terrain (nom, adresse, surface)
> >   La liste des gérants associés (sans actions)
> >   Les tarifs (sans formulaire)
> >
> > AJOUTER en haut de la fiche :
> >   Banner informatif discret :
> >   "Cette vue est en lecture seule. Pour modifier le terrain,
> >    contacte l'administration."
> >
> > AUCUN LIEN depuis les 4 onglets principaux vers cette fiche
> > Elle reste accessible via URL directe uniquement
> > (cas de lien externe ou bookmark)
> >
> > ```
> >
> > ---
> >
> > **PHASE 9 — Page Profil propriétaire**
> >
> > Créer `ProfilProprietaire.tsx` indépendant, aucun import depuis l'espace joueur ou gérant :
> >
> > ```
> > HEADER
> >   Fond var(--p-primary) hauteur 160px
> >   Photo profil circulaire 96px centrée, déborde sur le fond blanc
> >   Bordure blanche 3px
> >   Bouton appareil photo overlay → upload photo
> >   Prénom Nom 18px --font-display var(--p-text) centré
> >   Badge "Propriétaire" pill bleu centré
> >
> > INFOS (lecture seule)
> >   Prénom + Nom : lecture seule
> >   Téléphone : lecture seule
> >   Email : lecture seule
> >   Membre depuis : lecture seule
> >
> >   Mention : "Pour modifier tes informations,
> >   contacte l'administration"
> >
> > SECTION TERRAINS
> >   Liste des terrains associés (lecture seule)
> >   Nom + statut actif/inactif par terrain
> >
> > STATS RAPIDES (lecture seule)
> >   Nombre de terrains | Matchs joués ce mois | Score moyen gérants
> >
> > MOT DE PASSE
> >   Champ nouveau mot de passe
> >   Champ confirmer
> >   Bouton "Changer mon mot de passe"
> >
> > APPARENCE
> >   ThemeToggle (clair / sombre)
> >
> > DÉCONNEXION
> >   Tout en bas, pleine largeur, outline rouge
> >   → ConfirmationModal "Tu veux vraiment partir ? 👋"
> >
> > Ce composant utilise uniquement var(--p-xxx)
> > Aucun import depuis espaces/joueur/** ou espaces/backoffice/pages/gerant/**
> >
> > ```
> >
> > ---
> >
> > **PHASE 10 — Alertes proactives et empty states**
> >
> > Créer un système d'alertes calculées côté frontend depuis les données déjà chargées. Aucun appel API supplémentaire :
> >
> > ```js
> > // hooks/useAlertesProprietaire.ts
> > function useAlertesProprietaire(terrainStats, santeStats) {
> >   return useMemo(() => {
> >     const alertes = [];
> >
> >     for (const terrain of terrainStats) {
> >       // Alerte score santé rouge
> >       if (terrain.score_confiance < 50) {
> >         alertes.push({
> >           type: 'danger',
> >           terrain_nom: terrain.nom,
> >           gerant_prenom: terrain.gerant_prenom,
> >           message: `Score de confiance bas ce mois`,
> >           lien: '/backoffice/proprietaire/sante',
> >           label_lien: 'Voir la santé'
> >         });
> >       }
> >
> >       // Alerte occupation faible
> >       if (terrain.occupation_mois < 40) {
> >         alertes.push({
> >           type: 'warning',
> >           terrain_nom: terrain.nom,
> >           message: `Occupation faible ce mois (${terrain.occupation_mois}%)`,
> >           lien: '/backoffice/proprietaire/revenus',
> >           label_lien: 'Voir les revenus'
> >         });
> >       }
> >
> >       // Alerte aucun gérant assigné
> >       if (!terrain.gerant_id) {
> >         alertes.push({
> >           type: 'warning',
> >           terrain_nom: terrain.nom,
> >           message: `Aucun gérant assigné à ce terrain`,
> >           lien: null,
> >           label_lien: null
> >         });
> >       }
> >     }
> >
> >     return alertes;
> >   }, [terrainStats, santeStats]);
> > }
> >
> > ```
> >
> > Composant `AlerteProprietaire.tsx` :
> >
> > ```
> > Card compacte, border-radius 12px
> > Danger → fond var(--p-alert-bg), bordure var(--p-alert-border)
> > Warning → fond var(--p-attention-bg), bordure var(--p-attention)
> > Icône AlertTriangle à gauche
> > Message en 13px var(--p-text)
> > Bouton lien outline à droite si lien disponible
> > Animation fadeIn au premier affichage
> > Disparaît si la condition n'est plus vraie au prochain refresh
> >
> > ```
> >
> > **Empty states cohérents sur toutes les pages :**
> >
> > ```
> > Dashboard sans données :
> >   Illustration simple + "Tes terrains n'ont pas encore
> >   d'activité ce mois. Les données apparaîtront dès la
> >   première réservation confirmée."
> >
> > Revenus sans données :
> >   "Aucun encaissement sur cette période.
> >    Change la période ou vérifie avec ton gérant."
> >
> > Santé sans données :
> >   "Pas encore assez de données 😊
> >    Le tableau de bord se remplit au fur et à mesure
> >    des réservations."
> >
> > Terrains sans terrain :
> >   "Aucun terrain associé à ton compte.
> >    Contacte l'administration pour en ajouter un."
> >
> > ```
> >
> > ---
> >
> > **Règles absolues :**
> >
> > ```
> > Aucune action opérationnelle dans l'espace proprio
> >   (pas de scanner, pas de bloquer créneau, pas de CRUD gérant)
> > Aucun import depuis espaces/joueur/** ou gerant/**
> > Uniquement var(--p-xxx) pour toutes les couleurs
> > KPI Dashboard et Revenus = même source, même calcul
> > Fiche terrain/:id neutralisée mais pas supprimée
> > SSE conservé tel quel, pas de modification
> > Skeleton loaders sur tous les chargements AJAX
> > Touch targets 44px minimum sur mobile
> > Toutes les couleurs adaptées dark mode via .dark .proprio-app
> > Fournir le code complet de chaque fichier modifié
> >
> > ```
> >
> > ---
> >
> > **Livrable dans l'ordre :**
> >
> > 1. Rapport audit → validation
> > 2. Variables CSS `proprio-app` → validation
> > 3. `ProprietaireChrome.tsx` + routing terrains → validation
> > 4. Dashboard avec alertes + fil d'activité → validation
> > 5. Page Revenus alignée → validation
> > 6. Page Santé améliorée → validation
> > 7. Page Terrains route dédiée → validation
> > 8. Fiche `terrain/:id` neutralisée → validation
> > 9. `ProfilProprietaire.tsx` → validation
> > 10. `useAlertesProprietaire` + empty states → validation
> >
> > **Montre chaque fichier complet et attends ma validation avant de continuer.**

