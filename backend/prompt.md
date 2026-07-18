---

> Dans la page scanner du gérant `/backoffice/gerant/scanner`, après un scan échoué à cause de la fenêtre horaire, afficher un message clair et humain à l'écran. Ne toucher à rien d'autre.
>
> **Cas 1 — Scan trop tôt (avant 1h avant le match)**
> ```
> Icône horloge orange centrée
> Titre : "C'est un peu tôt 😄"
> Texte : "Tu pourras scanner ce QR code à partir de [heure_debut - 1h].
>          Reviens dans [X minutes]."
> Bouton "OK" qui ferme le message et réactive la caméra
> ```
>
> **Cas 2 — Scan trop tard (après 2h après la fin du match)**
> ```
> Icône alerte rouge centrée
> Titre : "Ce QR code a expiré"
> Texte : "Ce match était prévu le [date] à [heure].
>          Le délai de validation est dépassé.
>          Si c'est une erreur, contacte l'administration."
> Bouton "OK" qui ferme le message et réactive la caméra
> ```
>
> **Cas 3 — Scan réussi (match validé)**
> ```
> Flash vert plein écran pendant 0.5s
> Icône check vert animée centrée
> Titre : "Match validé ✅"
> Card récap :
>   Nom du joueur
>   Terrain
>   Date et heure du match
>   Code réservation TF-XXXXXX
> Bouton "Scanner un autre QR" qui réactive la caméra
> ```
>
> **Cas 4 — QR code invalide ou inconnu**
> ```
> Flash rouge plein écran pendant 0.5s
> Icône croix rouge centrée
> Titre : "QR code non reconnu"
> Texte : "Ce code ne correspond à aucune réservation valide."
> Bouton "Réessayer" qui réactive la caméra
> ```
>
> **Interface générale de la page scanner :**
> ```
> Plein écran caméra sur mobile
> Cadre de scan centré avec coins arrondis verts animés
> Ligne verte qui descend en boucle dans le cadre (animation scan)
> Texte discret sous le cadre : "Place le QR code dans le cadre"
> Bouton retour en haut à gauche (flèche blanche sur fond semi-transparent)
> Aucun autre élément sur l'écran pendant le scan
> ```
>
---

> Créer la page `/backoffice/proprietaire/sante` et le composant `SanteTerrainCard.jsx`. Appeler la route existante `GET /proprietaire/sante/:terrain_id` pour récupérer les données.
>
> ---
>
> **Page complète — disposition et contenu**
>
> ```
> HEADER
>   Titre : "Santé de ton terrain"
>   Sous-titre gris muted : "Mis à jour automatiquement chaque semaine"
>   Si le propriétaire a plusieurs terrains :
>     Select en haut à droite pour choisir le terrain
>     Les données se rechargent à chaque changement de terrain
>
> SECTION 1 — Score global (en haut, bien visible)
>   Grande card blanche centrée
>   Score en chiffre très grand --font-display (ex: "88")
>   Sous le chiffre : "/ 100"
>   Label : "Score de confiance de ton gérant"
>   Cercle de progression autour du score (stroke-dasharray animé au chargement)
>     > 75 → cercle vert
>     50-75 → cercle orange
>     < 50 → cercle rouge
>   Sous le cercle, une phrase selon la couleur :
>     Vert → "Tout va bien 👍"
>     Orange → "Pense à en parler avec ton gérant 😊"
>     Rouge → "On te conseille de contacter ton gérant"
>   Aucune explication du calcul, juste le score et la phrase
>
> SECTION 2 — Trois cards stats en grille
>   Card 1 : Matchs validés
>     Chiffre grand : "18 sur 24"
>     Barre de progression colorée dessous
>     Label : "Matchs scannés ce mois"
>     > 75% → vert
>     50-75% → orange
>     < 50% → rouge
>
>   Card 2 : Matchs non scannés
>     Chiffre grand en orange si > 0, vert si 0
>     Label : "En attente de validation"
>     Sous-label gris : "Matchs confirmés mais pas encore joués"
>     Bouton "Voir le détail" en outline vert
>       → ouvre un drawer en bas de l'écran (mobile) ou un modal (desktop)
>       → liste des réservations non scannées :
>           Nom joueur | Date | Heure | Code TF-XXXXXX
>           Chaque ligne en lecture seule, pas d'action possible
>
>   Card 3 : Annulations ce mois
>     Chiffre grand
>     Label : "Réservations annulées"
>     Aucune couleur alarmante sur cette card, toujours gris neutre
>     Sous-label : "Sur les 60 derniers jours"
>
> SECTION 3 — Historique des scores (graphique)
>   Titre : "Évolution du score"
>   Graphique barres recharts sur les 6 derniers mois
>   Chaque barre colorée selon le score :
>     > 75 → verte
>     50-75 → orange
>     < 50 → rouge
>   Axe X : mois (Jan, Fév, Mar...)
>   Axe Y : 0 à 100
>   Pas de légende complexe, juste les barres et les valeurs au survol
>
> SECTION 4 — Journal d'activité récent
>   Titre : "Activité récente de ton gérant"
>   Liste des 10 dernières actions depuis activite_gerant
>   Chaque ligne :
>     Icône selon l'action :
>       reservation_creee → icône calendrier vert
>       reservation_annulee → icône croix orange
>       qr_scanne → icône check vert
>       creneau_cree → icône plus bleu
>       creneau_supprime → icône corbeille orange
>     Label humain (pas technique) :
>       reservation_creee → "Réservation créée"
>       reservation_annulee → "Réservation annulée"
>       qr_scanne → "Match validé ✅"
>       creneau_cree → "Créneau ajouté"
>       creneau_supprime → "Créneau supprimé"
>     Date et heure à droite en gris muted
>   Bouton "Voir tout l'historique" en bas → page dédiée avec pagination
>
> SKELETON LOADERS
>   Pendant le chargement, afficher des skeleton loaders
>   pour chaque section, jamais d'écran blanc ou de spinner centré
>
> ÉTAT VIDE
>   Si aucune donnée disponible (terrain récent, pas encore de réservations) :
>   Illustration simple centrée + texte :
>   "Pas encore assez de données 😊
>    Le tableau de bord se remplit au fur et à mesure des réservations."
> ```
>
> ---
>
> **Règles de design :**
> - Mobile-first, toutes les sections empilées verticalement sur mobile
> - Sur desktop : section 2 en grille 3 colonnes, reste en pleine largeur
> - Aucune mention de fraude, surveillance ou triche dans les labels
> - Ton bienveillant partout, jamais accusatoire
> - Utiliser uniquement les variables CSS du système de design existant
> - Icônes uniquement depuis lucide-react
>
> ---
>
> **Route backend à vérifier avant le frontend :**
>
> `GET /proprietaire/sante/:terrain_id` doit retourner :
> ```json
> {
>   "score_confiance": 88,
>   "couleur": "vert",
>   "taux_scan": 80,
>   "matchs_scannes": 18,
>   "total_confirmes": 24,
>   "matchs_non_scannes": 6,
>   "annulations_total": 3,
>   "historique_scores": [
>     { "periode": "2024-01", "score": 90 },
>     { "periode": "2024-02", "score": 75 },
>     { "periode": "2024-03", "score": 88 }
>   ],
>   "activite_recente": [
>     {
>       "action": "qr_scanne",
>       "reservation_id": 12,
>       "created_at": "2024-03-15T18:30:00"
>     }
>   ],
>   "reservations_non_scannees": [
>     {
>       "joueur_nom": "Moussa Diallo",
>       "date": "2024-03-14",
>       "heure": "17:00",
>       "code": "TF-482910"
>     }
>   ]
> }
> ```
>
> Si cette route ne retourne pas encore tous ces champs, les ajouter avant de faire le frontend.
>
> Montre-moi le composant complet et la route backend et attends ma validation.