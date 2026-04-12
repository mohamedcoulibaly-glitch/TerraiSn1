

##  CAHIER DES CHARGES – PLATEFORME DE
## RÉSERVATION DE TERRAINS (SÉNÉGAL)
## 1. CONTEXTE & OBJECTIFS
## Contexte
Au Sénégal, la pratique du football, du basketball, du tennis et d’autres sports est très
répandue. Cependant, la réservation des terrains se fait souvent par téléphone ou sur
place, ce qui entraîne :
● Double réservation
● Perte de temps
● Manque de visibilité sur les créneaux disponibles
Objectif principal
Créer une plateforme centralisée qui permet :
● Aux joueurs de trouver et réserver des terrains facilement
● Aux gérants (employés) de gérer les réservations et horaires
● Aux propriétaires de gérer leurs terrains et employés
● Aux super administrateurs de superviser toute la plateforme

## 2. ACTEURS & RÔLES
## Acteur Rôle

## Joueur
Consulter les terrains, réserver, payer, consulter ses
réservations
## Gérant (employé)
Valider/refuser les réservations, gérer les horaires
d’un terrain
Propriétaire Gérer ses terrains, voir revenus, gérer les employés
## Super Admin
Accès total : gérer tous les propriétaires, stats
globales, configuration

## 3. FONCTIONNALITÉS DÉTAILLÉES
3.1 MODULE PUBLIC (sans connexion)
● Voir la liste des terrains (filtr es : ville, sport, prix, disponibilité)
● Voir les détails d’un terrain (photos, horaires, prix, avis)
● S’inscrire / se connecter
## 3.2 MODULE JOUEUR
● Réserver un terrain (choisir date, heure, terrain)
● Payer en ligne (Mobile Money, carte bancaire, Wave, Orange Money)
● Consulter ses réservations (passées, en attente, acceptées, refusées)
● Annuler une réservation (selon politique d’annulation)
● Notifications par SMS/Email (confirmation, rappel)
## 3.3 MODULE GÉRANT (EMPLOYÉ)
● Dashboard spécifique
● Voir les réservations du terrain assigné

● Valider / refuser une demande de réservation
● Gérer les horaires d’ouverture du terrain (par jour)
● Bloquer des créneaux (indisponibilité exceptionnelle)
## 3.4 MODULE PROPRIÉTAIRE
● Dashboard propriétaire
● CRUD terrains (ajouter, modifier, supprimer)
● Voir les revenus (journaliers, hebdomadaires, mensuels)
● Gérer les employés (ajouter, supprimer, affecter à un terrain)
● Voir les statistiques par terrain (taux d’occupation, CA)
● Consulter l’historique des réservations
## 3.5 MODULE SUPER ADMIN
● Dashboard global
● Gérer tous les propriétaires (valider, suspendre, supprimer)
● Statistiques globales (nombre de terrains, réservations, revenus, utilisateurs)
● Configuration système (commissions, modes de paiement, politique
d’annulation)
● Logs & audit
● Support client (tickets)

## 4. RÈGLES DE GESTION
## 4.1 Réservation
● Une réservation ne peut être faite que sur un créneau disponible
● Une réservation en attente expire après 15 minutes sans paiement
● Le montant total est calculé : prix_heure * nombre d’heures
● Statuts possibles : en_attente, acceptee, refusee, annulee
## 4.2 Horaires

● Un terrain peut avoir des horaires différents selon le jour
● Un créneau horaire est disponible si disponible = true
● Pas de chevauchement possible entre deux réservations acceptées
## 4.3 Paiement
● Paiement obligatoire à la réservation (sauf si autorisation spéciale)
● Modes : Orange Money, Wave, carte bancaire, espèces (sur place)
## 4.4 Rôles
● Un propriétaire peut avoir plusieurs terrains
● Un employé (gérant) est rattaché à un seul terrain
● Un super admin ne peut pas réserver

## 5. BASE DE DONNÉES (MCD → MLD)
Tables principales
users
## Champ Type Description
id INT PK

nom VARCHAR

email VARCHAR unique
password VARCHAR hashé

role ENUM
client, employee, proprietaire,
superadmin
proprietaire_id INT FK si role = employee
proprietaires
## Champ Type
id INT PK

nom VARCHAR

email VARCHAR

telephone VARCHAR

plan_abonnement VARCHAR free, premium, enterprise
terrains
## Champ Type
id INT PK

proprietaire_id INT FK

nom VARCHAR


adresse VARCHAR

ville VARCHAR (Dakar, Thiès, Saint-Louis...)
prix_heure DECIMAL

photos TEXT JSON ou URLs
horaires
## Champ Type
id INT PK

terrain_id INT FK

jour VARCHAR lundi, mardi...
heure_debut TIME

heure_fin TIME

disponible BOOL

reservations
## Champ Type
id INT PK


terrain_id INT FK

user_id INT FK

date DATE

heure_debut TIME

heure_fin TIME

statut ENUM en_attente, acceptee, refusee, annulee
montant DECIMAL

paiements
## Champ Type
id INT PK

reservation_id INT FK

montant DECIMAL

methode VARCHAR orange_money, wave, carte, especes
statut VARCHAR payé, remboursé, échoué
date TIMESTAMP


CAS D’UTILISATION (extraits UML)
Acteur Cas d’utilisation
Joueur S’inscrire, réserver, payer, consulter ses réservations
Gérant Valider/refuser réservation, gérer horaires
Propriétaire Gérer terrains, voir revenus, gérer employés
Super Admin Gérer propriétaires, stats globales, config
- Page d’accueil avec terrains populaires
- Liste des terrains (grille)
- Page détail terrain + calendrier de réservation
## 4. Paiement Mobile Money / Wave
- Dashboard propriétaire (graphiques)
- Dashboard gérant (liste réservations)
