# Cahier des charges — Paiements TerrainSN & interface Superadmin

| | |
|---|---|
| **Produit** | TerrainSN (SaaS multi-terrains, Sénégal) |
| **Document** | CDC Paiements · Caisse · Reversements · Superadmin |
| **Version** | 1.2 |
| **Date** | 18 août 2026 |
| **Statut** | Cible produit — à implémenter par phases |
| **Correctif v1.1** | Le dû est versé sur le **numéro du gérant**, pas du propriétaire |
| **Correctif v1.2** | Wave **et** Orange Money · politique d’annulation/remboursement · frais payin joueur / payout négociés · 2 modes (auto avec frais **ou** retrait manuel sans frais) · tout se configure en superadmin puis s’applique au moteur de paiement |
| **Périmètre** | Avance joueur, commission, dû gérant, frais, modes de reversement, config 100 % superadmin |
| **Hors périmètre v1** | Reste du match sur place · abonnements mensuels · achat définitif |

**Phrase cible :** le joueur paie TerrainSN (frais de payin côté joueur) → TerrainSN garde sa commission (propre à chaque terrain) → selon le **contrat du terrain** lu en superadmin, TerrainSN reverse le dû sur le **Wave / Orange Money du gérant** (auto avec frais, ou retrait à la demande sans frais), **après le délai de remboursement négocié**.

Aujourd’hui on compte ce qu’on doit. On ne vire pas.

**Règle d’architecture :** aucune logique de paiement n’invente un %, un délai, un numéro ou un mode. Elle **récupère la config superadmin du terrain** et l’applique.

---

## Table des matières

1. [Objet et film cible](#1-objet-et-film-cible)
2. [État actuel vs cible](#2-état-actuel-vs-cible)
3. [Glossaire](#3-glossaire)
4. [Principes non négociables](#4-principes-non-négociables)
5. [Contrat terrain — ce qu’on négocie](#5-contrat-terrain--ce-quon-négocie)
6. [Cycle de vie d’un FCFA](#6-cycle-de-vie-dun-fcfa)
7. [Calculs](#7-calculs)
8. [Interface Superadmin (source de vérité)](#8-interface-superadmin-source-de-vérité)
9. [Moteur de paiement — appliquer la config](#9-moteur-de-paiement--appliquer-la-config)
10. [Impact interface Gérant](#10-impact-interface-gérant)
11. [Impact interface Propriétaire](#11-impact-interface-propriétaire)
12. [Impact interface Joueur](#12-impact-interface-joueur)
13. [Notifications](#13-notifications)
14. [Modèle de données cible](#14-modèle-de-données-cible)
15. [Matrice des droits](#15-matrice-des-droits)
16. [Phasage](#16-phasage)
17. [Critères d’acceptation](#17-critères-dacceptation)
18. [Écrans superadmin](#18-écrans-superadmin)

---

## 1. Objet et film cible

### 1.1 Comment l’argent circule

Le joueur ne paie pas tout à la réservation. Il paie une **avance** (souvent ~12,5 % du prix) en Wave / Orange Money. Les **frais de payin** sont gérés **côté joueur** (au checkout PayTech).

Le reste, il le paie le jour du match, **sur place, au gérant**. TerrainSN n’y touche pas.

Exemple : créneau 40 000 → avance 5 000 en ligne → 35 000 sur place.

### 1.2 Où arrive l’avance, où elle ressort

À l’encaissement, l’avance n’arrive **pas** sur le Wave / OM du gérant.

Elle arrive sur le **compte TerrainSN** (via PayTech). Un seul compte : la caisse plateforme.

PayTech ne « connaît » pas le gérant. Le gérant ne configure rien chez PayTech.

**Ensuite**, TerrainSN reverse le dû (avance − commission − frais de payout **si mode auto**) sur le **numéro Wave et/ou Orange Money du gérant** — pas sur celui du propriétaire.

### 1.3 La commission

TerrainSN prend sa commission **uniquement sur l’avance**, pas sur les 40 000.

Chaque terrain a son %, négocié (8 %, 10 %, 15 %…). Même app, deals différents. Figé à la signature. Le proprio ne le change pas tout seul.

Exemple à 10 % : 5 000 d’avance → commission 500 → base gérant 4 500, **puis** éventuels frais de payout selon le mode et la négo.

### 1.4 Film cible

```
Négociation (proprio + gérant) → saisie 100 % en SUPERADMIN
  → % avance, % commission
  → Wave + Orange Money du gérant (idéalement = WhatsApp)
  → annulation avec remboursement ? oui/non + délai
  → mode de reversement (auto AVEC frais  OU  retrait à la demande SANS frais)
  → qui paie les frais de payout (gérant / plateforme / partage 1%–1%)

Joueur paie l’avance (+ frais payin à sa charge)
  → argent chez TerrainSN
  → on note le dû gérant (formule selon le mode)

Fenêtre de remboursement du terrain
  → si remboursement possible et annulation dans le délai : refund joueur, dû = 0
  → si pas de remboursement, OU délai écoulé sans annulation :
        AUTO     → reversement auto au gérant (appliquer la politique de frais)
        RETRAIT  → le dû s’accumule, bouton « Retirer » → WhatsApp côté dév
                   → virement manuel sur le numéro du gérant, SANS frais

Jour J (QR)
  → le reste du prix se paie SUR PLACE (hors TerrainSN)
```

---

## 2. État actuel vs cible

### 2.1 Déjà en place

- Le joueur paie seulement l’avance (`pourcentage_avance`).
- L’avance part chez PayTech (caisse TerrainSN).
- Commission % par terrain, lecture seule côté proprio.
- Reste du match sur place au scan QR.
- Portefeuille / reversements = **comptabilité**, pas d’argent réel.
- Superadmin a déjà : % avance, % commission, `delai_remboursement_heures`, utilisateurs.

### 2.2 Manquant (v1.2)

- Numéros **Wave et Orange Money** du gérant (idéalement = WhatsApp).
- Question métier : **annulation avec remboursement ?** souvent **non**, mais ça dépend du terrain + délai si oui.
- Frais de **payin** côté joueur vs frais de **payout** négociés (qui les prend, éventuellement partage 1 % / 1 %).
- **Deux modes** négociés avec le **propriétaire** : auto (frais côté client) **ou** retrait à la demande (notif WhatsApp dév, manuel, sans frais).
- Reversement **selon le délai de remboursement**, pas « dès le QR ».
- Gérant voit **en continu** ses avances accumulées (formule différente selon le mode).
- Le moteur de paiement **lit** ces configs superadmin au lieu de valeurs en dur.

---

## 3. Glossaire

| Terme | Signification |
|---|---|
| **Avance** | Part payée en ligne par le joueur |
| **Reste sur place** | Prix − avance. Jamais chez TerrainSN |
| **Commission** | % TerrainSN **sur l’avance uniquement** |
| **Frais de payin** | Frais d’entrée PayTech. **Côté joueur** |
| **Frais de payout** | Frais de sortie (reversement auto). Négociés : gérant, plateforme, ou **partage** (ex. 1 % gérant + 1 % dév) |
| **Dû gérant (mode auto)** | avance − commission − frais de payout à sa charge |
| **Dû gérant (mode retrait)** | avance − commission (**pas de frais**) |
| **Compte de versement** | Wave **et** Orange Money **du gérant** |
| **Mode auto** | Reversement automatique via PayTech, **avec frais** (politique du contrat) |
| **Mode retrait** | Bouton gérant → notif WhatsApp **côté dév** → envoi **manuel** sur le numéro du gérant, **sans frais** |
| **Fenêtre de remboursement** | Délai négocié. Souvent **0** (annulation sans remboursement) |
| **Payable** | Dû débloqué **après** la fenêtre de remboursement (ou tout de suite si pas de remboursement) |

Wording : ne plus dire « Virement reçu » tant que l’argent n’est pas réellement parti (auto PayTech confirmé **ou** virement manuel dév fait).

---

## 4. Principes non négociables

1. **Un seul compte PayTech** : TerrainSN. PayTech ne connaît pas le gérant.
2. **Commission uniquement sur l’avance.**
3. **% et contrat figés en superadmin.** Ni le proprio ni le gérant ne les éditent.
4. **Bénéficiaire = gérant** (Wave + OM). Le propriétaire supervise, il ne reçoit pas.
5. **Payin = joueur. Payout = négocié** (et **0 frais** en mode retrait manuel).
6. **Le reversement attend la politique de remboursement du terrain.** Pas de remboursement → l’argent peut partir au gérant dès que le contrat le permet. Remboursement possible → on attend la fin du délai (sauf annulation déjà refundée).
7. **Deux modes, négociés avec le propriétaire**, saisis en superadmin, lus par le moteur.
8. **Sans numéro gérant : le joueur paie, rien ne part.** Le dû s’accumule.
9. **Toute config passe par le superadmin.** Le code paiement fait `chargerContrat(terrain_id)` puis applique. Pas de if magique par terrain en dur.

---

## 5. Contrat terrain — ce qu’on négocie

Ces questions se posent **à la signature**, avec le gérant et/ou le propriétaire selon le sujet. La réponse est **saisie uniquement en superadmin**.

### 5.1 Numéros du gérant (demander au gérant)

| Question | Champ superadmin |
|---|---|
| Ton numéro **Wave** ? | `wave_numero` |
| Ton numéro **Orange Money** ? | `om_numero` |
| C’est le **même que WhatsApp** ? (idéal) | `numeros_identiques_whatsapp` (oui/non) + préremplissage depuis le WhatsApp gérant si oui |
| On teste 100 FCFA Wave / OM ? | statuts `wave_statut`, `om_statut` |

Les deux opérateurs sont demandés : le joueur paie en Wave **ou** OM ; le reversement part vers le numéro du gérant sur l’opérateur prévu (ou les deux enregistrés, ordre : préférence `canal_reversement` = `wave` \| `om` \| `les_deux`).

### 5.2 Annulation & remboursement (demander au gérant)

Souvent **une annulation ne porte pas sur un remboursement**. Ça dépend du terrain.

| Question | Champ superadmin |
|---|---|
| Annulation **avec** remboursement de l’avance ? | `remboursement_autorise` (`oui` / `non`) — défaut métier fréquent : **non** |
| Si oui, **délai** après confirmation ? | `delai_remboursement_heures` (ex. 6, 12, 24). Si non : forcer `0` |
| Texte joueur | généré : « Annulation sans remboursement » **ou** « Remboursé si tu annules dans les X h » |

**Effet sur le reversement :**

- `remboursement_autorise = non` (délai 0) → l’avance n’est plus « à risque refund ». Le dû peut être reversé au gérant selon le **mode** + la **politique de frais**.
- `remboursement_autorise = oui` + délai X h → le dû reste `en_fenetre_remboursement` jusqu’à X h. Annulation dans le délai → refund joueur, dû = 0. Après le délai sans annulation → dû `payable`.

### 5.3 Mode de reversement (négocier avec le **propriétaire**)

Deux modes possibles, **un seul actif par terrain** :

| Mode | Code | Frais de payout | Qui déclenche | Comment l’argent part |
|---|---|---|---|---|
| **Reversement automatique** | `auto` | **Oui** — à la charge définie au 5.4 (souvent « côté client » = gérant) | Le moteur, dès que le dû est `payable` | PayTech : « envoie X au numéro du gérant » |
| **Retrait à la demande** | `retrait` | **Non** | Bouton gérant « Retirer » → **notif WhatsApp côté dév** | L’équipe dév vire **manuellement** sur le numéro du gérant |

Le propriétaire choisit le mode. Le gérant le subit et le voit en lecture.

### 5.4 Frais de payout (négocier avec le **gérant**) — mode `auto` seulement

Les frais de **payin** ne se négocient pas ici : **côté joueur**.

Les frais de **payout** (sortie) se négocient. Toujours **consulter cette politique** avant un reversement auto.

| Qui prend en charge | Code | Exemple sur 4 500 de base |
|---|---|---|
| Gérant (côté client) | `gerant` | Frais déduits du dû. Le gérant reçoit moins |
| Plateforme / dév | `plateforme` | Gérant reçoit 4 500. TerrainSN paie les frais |
| **Partage** | `partage` | Ex. **1 % gérant + 1 % dév** (champs `frais_payout_pct_gerant` + `frais_payout_pct_plateforme`, défaut 1 / 1) |

En mode `retrait` : cette grille **ne s’applique pas**. Montant envoyé = avance − commission.

---

## 6. Cycle de vie d’un FCFA

Exemple : créneau **40 000**, avance **5 000**, commission **10 %** (500), frais payout **partage 1 % / 1 %**.

```
Joueur paie 5 000 + frais payin (à sa charge, checkout)
        │
        TerrainSN caisse : +5 000
        Commission : 500
        Base gérant : 4 500
        │
        ├─ Remboursement autorisé + annulation dans le délai
        │     → refund joueur (avance, hors frais payin déjà pris par l’opérateur)
        │     → dû gérant = 0
        │
        └─ Pas de remboursement, OU délai écoulé
              dû devient PAYABLE
              │
              ├─ Mode AUTO
              │     frais gérant 1 % de 4 500 = 45  → reçu gérant 4 455
              │     frais dév 1 % = 45              → TerrainSN les absorbe
              │     ordre PayTech → Wave/OM du gérant
              │
              └─ Mode RETRAIT
                    solde affiché / envoyé = 4 500 (pas de frais)
                    gérant clique « Retirer »
                    → WhatsApp équipe dév (montant, terrain, numéro Wave, numéro OM)
                    → virement manuel, solde app = 0
```

Le **QR / match joué** déclenche l’encaissement **sur place des 35 000**. Il ne déclenche **pas** le reversement de l’avance (c’est le délai de remboursement + le mode).

---

## 7. Calculs

FCFA entiers, snapshotés à la confirmation (un avenant ne recalcule pas le passé).

```
avance            = arrondi(prix × pourcentage_avance / 100)
reste_sur_place   = prix − avance
commission        = arrondi(avance × commission_pourcentage / 100)
base_gerant       = avance − commission

si mode == retrait :
    du_gerant     = base_gerant
    frais_gerant  = 0
    frais_plateforme = 0

si mode == auto :
    lire politique frais du contrat
    frais_gerant      = arrondi(base_gerant × frais_payout_pct_gerant / 100)      # 0 si plateforme paie tout
    frais_plateforme  = arrondi(base_gerant × frais_payout_pct_plateforme / 100)  # 0 si gérant paie tout
    du_gerant         = base_gerant − frais_gerant
```

Preview obligatoire dans le superadmin, exemple live :

> Créneau 40 000 → avance 5 000 → commission 500 →  
> Auto (partage 1/1) : gérant **4 455**, frais gérant 45, frais dév 45  
> Retrait : gérant **4 500**, 0 frais

---

## 8. Interface Superadmin (source de vérité)

C’est **là que se fait toute la configuration**. Le reste de l’app n’a que de la lecture / des déclencheurs.

### 8.1 Menu cible

| Menu | Rôle |
|---|---|
| **Dashboard** | Santé caisse, file remboursement, file retrait dév, alertes |
| **Terrains** | Fiche **contrat paiement** (cœur) |
| **Utilisateurs** | Proprio / gérant — WhatsApp utilisé pour préremplir les numéros |
| **Caisse & reversements** | Auto PayTech + file **retraits manuels** (demandes WhatsApp) |
| **Rapprochement** | Reçu / remboursé / gardé (commission) / frais / envoyé / encore dû |
| **Revenus** | Commission acquise + frais payout absorbés vs facturés |
| **Abonnements** | Hors flux avance |

### 8.2 Fiche terrain — onglet « Contrat paiement »

Un seul écran de signature, **4 blocs**, tous enregistrés avant d’activer le terrain en production paiement.

#### Bloc 1 — Commercial (déjà en partie là)

- `% avance` + preview prix → avance / reste sur place
- `% commission` + preview
- Bénéficiaire : **gérant** (non modifiable)

#### Bloc 2 — Numéros gérant

- WhatsApp gérant (référence)
- Case « Utiliser le même numéro pour Wave et Orange Money »
- `wave_numero` / `om_numero` (si case cochée : les deux = WhatsApp)
- Canal de reversement préféré : Wave / OM
- Test 100 FCFA par canal
- Statut par canal : `absent` / `saisi` / `test_envoye` / `verifie`

Sans **au moins un** canal `verifie` : joueur paie, rien ne sort, badge rouge.

#### Bloc 3 — Annulation / remboursement

- `remboursement_autorise` : **Non (souvent)** / Oui
- Si oui : délai en heures
- Phrase générée montrée au joueur (lecture)

#### Bloc 4 — Reversement & frais

- Mode : `auto` **ou** `retrait` (négocié proprio)
- Si `auto` : politique frais `gerant` / `plateforme` / `partage`
- Si `partage` : deux % (défaut **1** et **1**)
- Preview des 2 formules (auto vs retrait) pour le même exemple 40 000
- Bandeau : « En mode retrait, 0 frais. En mode auto, appliquer cette politique. »

Avenant = nouvelle `contrat_version`, effet **futur uniquement**, audit (qui, quand, avant/après).

Le proprio et le gérant voient ces blocs **en lecture**.

### 8.3 Dashboard — KPI à ajouter

- Encaissé PayTech
- Commission acquise / encore en fenêtre de remboursement
- Dû en fenêtre / dû payable
- File **demandes de retrait** (non traitées)
- Bloqué sans numéro
- Auto payouts échoués
- Frais payout (part gérant vs part plateforme)

Alertes : terrain sans Wave/OM, test 100 FCFA en attente, retrait demandé depuis > 1 h, auto en échec, fenêtre remboursement qui vient d’expirer (prêt à reverser).

### 8.4 Caisse & reversements

**Trois files :**

1. **En fenêtre de remboursement** — lecture, pas d’envoi
2. **Payable auto** — le moteur envoie ; relance / log PayTech
3. **Demandes de retrait** — créées par le bouton gérant. Colonnes : terrain, gérant, montant (**avance − commission**), Wave, OM, WhatsApp, heure de la demande. Actions dév : `Marquer envoyé` (saisir réf manuelle) / `Rejeter` (motif, le dû **reste**)

Le bouton « Verser » superadmin existe pour l’auto (PayTech) **et** pour cocher un retrait manuel fait.

Historique unique : `auto` / `retrait_manuel`, montant, frais, numéro, statut, qui (moteur / superadmin / dév).

### 8.5 Rapprochement

```
reçu − remboursé = commission + frais_payout_plateforme_absorbés + envoyé + encore_dû
```

`encore_dû` ventilé : `en_fenetre` / `payable_auto` / `payable_retrait` / `bloque_sans_numero` / `echec`.

---

## 9. Moteur de paiement — appliquer la config

Au `sale_complete` PayTech (avance joueur) **et** à chaque tick / job de fenêtre :

```
contrat = chargerContrat(terrain_id)   // superadmin uniquement
appliquer :
  avance, commission, base_gerant
  statut dû = en_fenetre SI remboursement_autorise ET now < confirme_at + délai
           = payable SINON
  si payable et mode == auto et canal verifie :
      montant = base_gerant − frais selon contrat.politique_frais
      ordonner PayTech → numéro gérant (canal préféré)
  si payable et mode == retrait :
      accumuler au solde gérant (montant = base_gerant)
      attendre bouton Retirer
```

**Ne pas verser si :** encore en fenêtre, déjà remboursé, déjà versé, aucun canal vérifié, montant 0, (mode auto) caisse PayTech insuffisante.

**Échec auto :** dû inchangé, notif admin + gérant, relance superadmin, max 3 tentatives.

**Retrait :** le bouton **ne parle pas à PayTech**. Il crée une `demande_retrait` + WhatsApp **équipe dév** :

```
Retrait gérant demandé
Terrain : …
Gérant : …
Montant : 4 500 FCFA (avance − commission, 0 frais)
Wave : 77…42
OM   : 77…42
WhatsApp : 77…42
```

Le dév vire à la main, coche « Envoyé » dans le superadmin. Solde app = 0.

Idempotence : **un payout réussi (auto ou manuel) par réservation**.

---

## 10. Impact interface Gérant

Opérateur du jour J **et** bénéficiaire du dû.

### 10.1 Ce qu’il voit **en continu** (portefeuille / finances)

Un solde d’**avances accumulées**, toujours visible, recalculé depuis la config du terrain :

| Mode du contrat | Formule affichée | Label |
|---|---|---|
| `auto` | Σ (avance − commission − **frais**) | « Versé / sera versé auto sur ton Wave-OM » |
| `retrait` | Σ (avance − commission) | « Disponible au retrait (0 frais) » |

Détail par ligne : avance brute, commission, frais (0 si retrait), net, statut (`en fenêtre` / `payable` / `versé` / `demande envoyée aux dév`).

### 10.2 Actions

- Mode `auto` : **pas** de bouton Retirer. Texte : « Reversé automatiquement après le délai de remboursement de ton terrain (souvent tout de suite s’il n’y a pas de remboursement). Frais selon le contrat. »
- Mode `retrait` : bouton **« Retirer »** dès que le net > 0 et hors fenêtre. Confirmation : montant **sans frais**, numéros Wave/OM. Envoi notif dév. État « Demande envoyée — virement manuel en cours ».
- Numéros : lecture + **demande de changement** (superadmin valide). Case « c’est mon WhatsApp » en lecture.
- Jour J : scan QR + 35 000 sur place **inchangé**.

### 10.3 WhatsApp gérant

- Confirmation joueur : avance reçue chez TerrainSN + reste sur place + « ton dû s’accumule (auto / retrait) ».
- Fin de fenêtre / payable auto : « reversement en cours vers ton Wave/OM ».
- Payout auto OK / retrait marqué envoyé : « X FCFA envoyés sur …42 ».
- **Pas** « Virement reçu » au moment du paiement joueur.

---

## 11. Impact interface Propriétaire

Superviseur. Il a négocié le **mode**. Il ne reçoit pas l’argent.

Lecture :

- Commission figée
- Mode : auto (frais côté client selon contrat) **ou** retrait sans frais
- Politique remboursement du terrain
- Avances accumulées **versées au gérant** (formule du mode)
- Numéros gérant masqués

Interdit : changer %, mode, frais, numéros, cliquer Retirer, se mettre comme bénéficiaire.

---

## 12. Impact interface Joueur

Il ne voit ni commission, ni frais de payout, ni Wave gérant.

- Checkout : avance + **frais de payin** (côté joueur, PayTech)
- Copy : « Tu paies X maintenant (hors frais opérateur). Le jour J, Y sur place. »
- Annulation : texte **généré depuis le contrat** (« pas de remboursement » **ou** « dans les X h »)
- Terrain sans Wave/OM : il paie quand même

---

## 13. Notifications

| Événement | Destinataire | Message |
|---|---|---|
| Avance payée | Joueur | Confirmation, QR, reste sur place, politique d’annulation du terrain |
| Avance payée | Gérant | Résa + reste sur place. Dû accumulé, **pas** « virement reçu » |
| Fenêtre finie + mode auto | Gérant | Reversement en cours vers Wave/OM |
| Auto PayTech OK | Gérant | X FCFA envoyés (net, frais déjà déduits si à sa charge) |
| Clic **Retirer** | **Équipe dév (WhatsApp)** | Montant sans frais + Wave + OM + terrain + gérant |
| Dév marque « Envoyé » | Gérant | X FCFA envoyés manuellement |
| Échec auto / numéro faux | Superadmin + gérant | Dû inchangé, corriger le numéro |
| Numéro manquant + 1er dû | Superadmin | Configurer Wave/OM gérant |
| Test 100 FCFA | Gérant | Mini-virement, confirme |

---

## 14. Modèle de données cible

### 14.1 Contrat `terrains` (écrit **uniquement** par superadmin)

```
pourcentage_avance
commission_pourcentage
remboursement_autorise          -- 0/1  (souvent 0)
delai_remboursement_heures      -- 0 si non
payout_mode                     -- auto | retrait
payout_frais_politique          -- gerant | plateforme | partage
frais_payout_pct_gerant         -- ex. 1
frais_payout_pct_plateforme     -- ex. 1
wave_numero, wave_statut, wave_verifie_at
om_numero, om_statut, om_verifie_at
numeros_identiques_whatsapp     -- 0/1
canal_reversement               -- wave | om | les_deux
gerant_id                       -- gérant actif
contrat_version, contrat_signe_at
```

Le moteur : `SELECT ... FROM terrains WHERE id = ?` puis calcule. **Zéro constante métier dans le flow paiement.**

### 14.2 Ledger dû / portefeuille

Par **terrain** (suit le terrain si le gérant change) + snapshot du gérant / numéros / formule au moment du payable.

Statuts dû : `en_fenetre` → `payable` → `demande_retrait` (mode retrait) → `verse` \| `echec` \| `annule_rembourse`.

### 14.3 `payouts` + `demandes_retrait`

- Auto : `ref_paytech`, frais_gerant, frais_plateforme, montant_net, canal
- Retrait : `demande_par`, `traite_par` (dév), `ref_manuelle`, montant = base_gerant, frais = 0

---

## 15. Matrice des droits

| Action | Superadmin | Proprio | Gérant | Joueur | Dév (même rôle admin ops) |
|---|---|---|---|---|---|
| Saisir tout le contrat (§5) | Écriture | Lecture | Lecture | — | — |
| Wave + OM + test 100 FCFA | Écriture | Lecture | Demande de changement | — | — |
| Choisir mode auto / retrait | Écriture (négo proprio) | Lecture (c’est sa négo) | Lecture | — | — |
| Politique frais payout | Écriture (négo gérant) | Lecture | Lecture | — | — |
| Remboursement oui/non + délai | Écriture (négo gérant) | Lecture | Lecture | Subit le texte | — |
| Voir avances accumulées | Oui | Oui (ses terrains) | **Oui, en continu** | — | Oui |
| Bouton Retirer | Peut traiter la file | Non | Oui si mode `retrait` | — | Reçoit WhatsApp + coche Envoyé |
| Reversement auto PayTech | Relance / incident | — | Reçoit | — | — |
| Payer l’avance + frais payin | — | — | — | Oui | — |
| Encaisser 35 000 sur place | — | — | Oui | Paie | — |

---

## 16. Phasage

**Phase 0 — Vérité des chiffres**  
Ledger : fenêtre de remboursement, pas « déjà versé ». Wording honnête.

**Phase 1 — Contrat superadmin**  
Les 4 blocs. Le moteur **lit** déjà avance / commission / délai / mode / frais / numéros (même si le payout réel n’est pas branché). Preview 40 000. Gérant voit le solde selon la **bonne formule**.

**Phase 2 — Mode `retrait`**  
Bouton → WhatsApp dév → case « Envoyé » superadmin. 0 frais. File demandes.

**Phase 3 — Mode `auto`**  
Ordre PayTech, politique de frais (dont partage 1/1), historique, relance.

**Phase 4 — Rapprochement**  
Équation d’or + export.

Ne pas activer l’auto tant que PayTech n’est pas autorisé à **sortir** de l’argent et qu’un canal gérant n’est pas `verifie`.

---

## 17. Critères d’acceptation

1. Superadmin enregistre Wave **et** OM, case « = WhatsApp » préremplit les deux. Le flow paiement relit ces champs, rien n’est en dur.
2. Terrain « pas de remboursement » → dû `payable` dès la confirmation ; pas d’attente QR.
3. Terrain « remboursement 24 h » + annulation à 3 h → refund joueur, dû gérant = 0, aucun reversement.
4. Même terrain, pas d’annulation, 24 h plus tard → dû `payable`.
5. Mode `auto` + partage 1/1 + avance 5 000 + com 10 % → gérant **4 455**, plateforme absorbe 45, ordre vers le **numéro du gérant**.
6. Mode `retrait` + mêmes montants → solde gérant **4 500** ; clic Retirer → WhatsApp dév avec Wave + OM ; **aucun** frais déduit ; « Envoyé » remet le solde à 0.
7. Gérant voit en continu la bonne formule (auto vs retrait).
8. Frais payin : uniquement au checkout joueur. Jamais déduits du dû gérant.
9. Propriétaire : voit le mode qu’il a négocié, ne reçoit rien, n’édite rien.
10. Sans numéro vérifié : joueur paie, dû s’accumule, pas d’auto ni de retrait abouti.
11. Changement de gérant : prochains reversements vers les **nouveaux** Wave/OM (re-vérifiés). Dû du terrain non perdu.
12. Un seul reversement réussi par réservation (auto **ou** manuel).

---

## 18. Écrans superadmin

1. **Liste terrains** : `Com. 10 %` · `Avance 12,5 %` · `Rembours. non` ou `24 h` · `Mode auto 1+1` / `Retrait 0 frais` · `Wave+OM vérifiés` · dû.
2. **Fiche → Contrat paiement** : 4 blocs + preview 40 000 (les deux formules).
3. **Caisse** : fenêtre / payable auto / **file retraits dév**.
4. **Rapprochement** + frais payout.
5. **Revenus** : commission + frais absorbés par la plateforme (pas les 40 000).

---

## Synthèse

Le superadmin est le **contrat vivant** du terrain (numéros gérant Wave+OM, remboursement souvent refusé + délai si oui, mode auto avec frais ou retrait manuel sans frais, partage éventuel 1 % / 1 %).

Le moteur de paiement **récupère ce contrat et l’applique**.

Le joueur paie l’avance (+ payin). Le gérant voit ses avances s’accumuler (nette selon le mode) et les reçoit sur **son** numéro. Le propriétaire a choisi le mode, il ne touche pas à l’argent.

---

*TerrainSN · CDC Paiements & Superadmin · v1.2 · 18 août 2026*
