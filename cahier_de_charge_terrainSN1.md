

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
● Payer en ligne (Wave, Orange Money)
● Consulter ses réservations (passées, en attente, acceptées, refusées)
● Annuler une réservation (selon politique d’annulation)
● Notifications via WhatsApp (confirmation, rappel, refus)
● Bouton WhatsApp de réservation : sur la page détail d'un terrain, un grand bouton vert WhatsApp permet au joueur d'envoyer directement un message pré-rempli au gérant (terrain, date, heure, créneau choisi) via un lien wa.me avec le message encodé
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
● Modes acceptés : Wave, Orange Money uniquement
● Aucun paiement par carte bancaire ou espèces sur la plateforme
## 4.4 Notifications WhatsApp
● Canal unique de notification : WhatsApp (pas de SMS ni d'email)
● Un lien wa.me est généré dynamiquement avec le numéro WhatsApp du gérant du terrain concerné
● Le message est pré-rempli automatiquement avec : nom du terrain, date, heure de début, heure de fin, montant estimé, nom du joueur
● Format du lien : https://wa.me/<numero_gerant>?text=<message_encode>
● Exemple de message pré-rempli :
  "Bonjour, je souhaite réserver le terrain [NOM_TERRAIN] le [DATE] de [H_DEBUT] à [H_FIN]. Montant : [MONTANT] FCFA. Merci de confirmer."
● Le bouton WhatsApp est affiché de manière bien visible (grand bouton vert) sur :
  - La page détail d'un terrain
  - La page de confirmation après sélection d'un créneau
● Le gérant doit avoir un numéro WhatsApp renseigné dans son profil (champ whatsapp_number obligatoire dans la table employes)

## 4.5 Rôles
● Un propriétaire peut avoir plusieurs terrains
● Un employé (gérant) est rattaché à un seul terrain
● Un super admin ne peut pas réserver

## 5. BASE DE DONNÉES (MCD → MLD)

### Principe de séparation des comptes
- **Joueurs & Super Admins** → table `users` (role = joueur ou superadmin)
- **Propriétaires** → table `proprietaires` (compte séparé avec authentification)
- **Employés / Gérants** → table `employes` (liés à 1 propriétaire + 1 terrain)

---

### 5.1 AUTHENTIFICATION & UTILISATEURS

#### Table : users
| Champ | Type | Description |
|---|---|---|
| id | INT | PK |
| nom | VARCHAR | |
| email | VARCHAR | UNIQUE |
| password_hash | VARCHAR | hashé (nullable pour joueurs sans compte) |
| telephone | VARCHAR | |
| role | ENUM | joueur, superadmin |
| is_active | BOOL | |
| created_at | TIMESTAMP | |

#### Table : proprietaires
| Champ | Type | Description |
|---|---|---|
| id | INT | PK |
| nom | VARCHAR | |
| email | VARCHAR | UNIQUE |
| password_hash | VARCHAR | hashé |
| telephone | VARCHAR | |
| plan | ENUM | free, premium, enterprise |
| statut | ENUM | actif, suspendu |
| created_at | TIMESTAMP | |

#### Table : employes
| Champ | Type | Description |
|---|---|---|
| id | INT | PK |
| proprietaire_id | INT | FK → proprietaires |
| terrain_id | INT | FK → terrains (1 seul terrain par employé) |
| nom | VARCHAR | |
| email | VARCHAR | UNIQUE |
| password_hash | VARCHAR | hashé |
| telephone | VARCHAR | |
| whatsapp_number | VARCHAR | OBLIGATOIRE (utilisé pour le bouton WhatsApp joueur) |
| is_active | BOOL | |
| created_at | TIMESTAMP | |

---

### 5.2 TERRAINS & DISPONIBILITÉS

#### Table : terrains
| Champ | Type | Description |
|---|---|---|
| id | INT | PK |
| proprietaire_id | INT | FK → proprietaires |
| nom | VARCHAR | |
| adresse | VARCHAR | |
| ville | VARCHAR | Dakar, Thiès, Saint-Louis... |
| sport | ENUM | foot, basket, tennis... |
| prix_heure | DECIMAL | |
| photos | JSON | URLs des photos |
| is_active | BOOL | |

#### Table : horaires
| Champ | Type | Description |
|---|---|---|
| id | INT | PK |
| terrain_id | INT | FK → terrains |
| jour | ENUM | lundi, mardi, mercredi, jeudi, vendredi, samedi, dimanche |
| heure_debut | TIME | |
| heure_fin | TIME | |
| est_ouvert | BOOL | |

#### Table : blocages_creneaux
| Champ | Type | Description |
|---|---|---|
| id | INT | PK |
| terrain_id | INT | FK → terrains |
| employe_id | INT | FK → employes |
| date | DATE | |
| heure_debut | TIME | |
| heure_fin | TIME | |
| motif | VARCHAR | raison du blocage |

---

### 5.3 RÉSERVATIONS & PAIEMENTS

#### Table : reservations
| Champ | Type | Description |
|---|---|---|
| id | INT | PK |
| terrain_id | INT | FK → terrains |
| joueur_id | INT | FK → users |
| date | DATE | |
| heure_debut | TIME | |
| heure_fin | TIME | |
| montant | DECIMAL | prix_heure × durée |
| statut | ENUM | en_attente, acceptee, refusee, annulee |
| expire_at | TIMESTAMP | created_at + 15 min (expiration sans paiement) |
| traite_par | INT | FK → employes (nullable, gérant qui a traité) |
| created_at | TIMESTAMP | |

#### Table : paiements
| Champ | Type | Description |
|---|---|---|
| id | INT | PK |
| reservation_id | INT | FK → reservations |
| montant | DECIMAL | |
| methode | ENUM | orange_money, wave |
| statut | ENUM | paye, rembourse, echoue |
| reference_externe | VARCHAR | ID retourné par l'API Wave / Orange Money |
| created_at | TIMESTAMP | |

---

### 5.4 AVIS, NOTIFICATIONS & AUDIT

#### Table : avis
| Champ | Type | Description |
|---|---|---|
| id | INT | PK |
| reservation_id | INT | FK → reservations (uniquement après réservation acceptée) |
| joueur_id | INT | FK → users |
| terrain_id | INT | FK → terrains |
| note | INT | 1 à 5 |
| commentaire | TEXT | |
| created_at | TIMESTAMP | |

#### Table : notifications
| Champ | Type | Description |
|---|---|---|
| id | INT | PK |
| destinataire_type | ENUM | user, employe, proprietaire |
| destinataire_id | INT | ID selon le type |
| type | ENUM | confirmation, rappel, refus, annulation |
| canal | ENUM | whatsapp |
| contenu | TEXT | message envoyé |
| lu | BOOL | |
| created_at | TIMESTAMP | |

#### Table : audit_logs
| Champ | Type | Description |
|---|---|---|
| id | INT | PK |
| acteur_type | ENUM | user, employe, proprietaire, superadmin |
| acteur_id | INT | |
| action | VARCHAR | ex: VALIDER_RESERVATION, SUPPRIMER_TERRAIN |
| table_cible | VARCHAR | |
| enregistrement_id | INT | |
| details | JSON | données avant/après modification |
| created_at | TIMESTAMP | |

---

### 5.5 CAS D'UTILISATION

| Acteur | Cas d'utilisation |
|---|---|
| Joueur | Consulter terrains, réserver via bouton WhatsApp, payer (Wave/Orange Money), consulter ses réservations |
| Gérant | Valider/refuser réservation, gérer horaires, bloquer créneaux |
| Propriétaire | Gérer terrains, voir revenus, gérer employés |
| Super Admin | Gérer propriétaires, stats globales, config, audit logs |

### 5.6 PAGES PRINCIPALES

- Page d'accueil avec terrains populaires
- Liste des terrains (grille avec filtres : ville, sport, prix, disponibilité)
- Page détail terrain + calendrier de réservation + **bouton WhatsApp pré-rempli**
- Page de confirmation de réservation + bouton WhatsApp
- Paiement Wave / Orange Money
- Dashboard propriétaire (graphiques revenus, taux d'occupation)
- Dashboard gérant (liste réservations à traiter)
