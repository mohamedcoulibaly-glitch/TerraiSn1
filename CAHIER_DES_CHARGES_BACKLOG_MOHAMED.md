# Cahier des charges — workflow paiement, auth, WhatsApp, QR et configs

**Projet :** TerrainSN  
**Périmètre :** stories backend assignées à Mohamed (backlog paiement / auth / notifications / créneaux / WhatsApp / QR / médias / tarifs / sécurité / fixtures)  
**Statut :** contrat d’implémentation. Aucune estimation de charge.  
**Hors périmètre :** stories front (`Toi (Front)` : US-02, US-04, US-07, US-09, US-11, US-13, US-15, US-17, US-18, US-20, US-22, US-24, US-26, US-27).  
**Document voisin :** `CAHIER_DES_CHARGES_MOHAMED.md` (lot check-in gérant v2.1) reste valable. Ce document le complète ; il ne le remplace pas. En cas de conflit sur le scan QR, les règles anti-fraude du lot v2.1 priment (`match_joue`, `qr_code_scanne_at` irréversible, isolation `terrain_id`).

---

## 1. Problème à résoudre

Aujourd’hui le métier et la technique divergent sur le moment où une réservation devient réelle.

| Constat dans le code | Fichier | Conséquence |
|---|---|---|
| Création joueur écrit `statut = 'en_attente'` et génère déjà `code_reservation` + `qr_code_payload` | `backend/index.js`, `creerReservationAvecPaiement` | Un QR existe avant paiement |
| La confirmation WhatsApp joueur est appelée dans `confirmerPaiementEtNotifier`, après IPN | `backend/payments/flow.js` | Le bon endroit existe, mais l’`UPDATE` ne matche que `statut = 'en_attente'` |
| Idempotence partielle : résa déjà `confirme`, paiement `paye` ou `dus` déjà créé → `already_confirmed` | `traiterConfirmationPaytech` | Pas de job si l’IPN n’arrive jamais |
| Verrou 15 min présent (`lockCreneauxAtomique`, `delai_verrou_paiement_min`) mais le conflit SQL lit `en_attente`, pas `en_attente_paiement` | `reservationLockService.js` | La règle métier n’est pas alignée sur le statut cible |
| Mode sans avance confirme tout de suite et crée la dette, sans WhatsApp de confirmation joueur | `index.js` + `politiquePaiement.js` | Le joueur n’est pas notifié |
| Sessions OpenWA dans une `Map` mémoire | `whatsappClient.js` | Redémarrage Render = session perdue |
| `GET /api/whatsapp/status` peut refléter la mémoire plus que la persistance | `index.js` | État fantôme |
| QR JSON sans signature ; le scan vérifie id/code/terrain, pas la signature | `services/qrPayload.js`, `gerantCheckin.js` | Payload forgeable |
| Photos : jpeg / png / webp uniquement, 5 Mo | `terrainPhotoService.js` | HEIC téléphone refusé |
| Pas de champ « prix affiché carte » distinct du prix de réservation | tarifs / formats | L’accueil ne peut pas lire une config dédiée |
| SSE terrain existe (`notifyTerrain`) sans événement `reservation_confirmee` ni `config_updated` | `realtimeHub.js` | Le gérant et les configs restent asynchrones |
| Rate-limit mémoire, actif seulement en prod ou si `AUTH_RATE_LIMIT=1` | `middleware/rateLimit.js` | Pas de lockout progressif, pas de journal 429 |
| Inscription persiste déjà `users` + OTP → `telephone_verified` | `index.js` `/api/auth/register` | Pas d’audit auth ; la logique est noyée dans `index.js` |
| `logActivite` n’accepte que des actions gérant | `auditService.js` | Inutilisable tel quel pour l’audit inscription |

Le résultat attendu : **seul un paiement réussi** (ou la branche métier sans avance) confirme, notifie et émet un QR. Tout le reste est verrouillé, expirables, ou rejeté.

---

## 2. Principes d’architecture

1. **Le domaine sort de `index.js`.** Les routes restent des adaptateurs HTTP. La décision métier vit dans des modules appelables sans Express.
2. **Effets de bord derrière des ports.** WhatsApp, push, SSE, prestataire de paiement et alerte admin sont injectables. Les tests passent des espions. Le défaut de production reste les services actuels.
3. **Une transition = une fonction pure + une transaction SQL.** Pas de deuxième chemin qui confirme « en douce ».
4. **Idempotence au domaine**, pas seulement au webhook. La clé est `(reservation_id, ref_command)` et l’état déjà `confirme`.
5. **Compatibilité legacy.** Les lignes `statut = 'en_attente'` déjà en base restent confirmables par IPN. Les nouvelles créations joueur écrivent `en_attente_paiement`.
6. **Ne pas réécrire** PayTech, PayDunya, le ledger `dus`, le payout, ni le check-in `match_joue`. On les appelle au bon moment.
7. **Mock ≠ prod.** `WHATSAPP_MOCK=true` ne peut jamais produire `readyForProd: true`.
8. **Les routes de test n’existent que si `E2E_MODE=1`.**

### 2.1 Modules cibles

```
backend/
  domain/
    reservationState.js      machine à états, transitions autorisées
    prixCarte.js             résolution prix affiché (pur)
    qrSignature.js           HMAC sign / verify (pur)
    rateLimitPolicy.js       fenêtres, plafond, lockout progressif (pur)
  services/
    reservationWorkflow.js   création joueur / gérant, expiration, sans avance
    paymentConfirmation.js   enveloppe de confirmerPaiementEtNotifier (ou extension de payments/flow.js)
    ipnReconciliation.js     job pending → prestataire → confirm ou alerte
    authAccountService.js    register, verify OTP, login, émission JWT
    authAudit.js             journal auth (table dédiée, pas activite_gerant)
    openwaSessionStore.js    persistance session + health
    whatsappStatus.js        source de vérité statut (DB + health)
    configVersion.js         incrément version + event
    notificationPort.js      façades minces vers notificationService / pushService / realtimeHub
  test/
    helpers/harness.js       existant
    helpers/spies.js         spies WhatsApp, push, SSE, gateway, alertes
    helpers/fixtureDb.js     sqlite temporaire + terrain/contrat/users minimaux
    unit/usXX-*.js
    parcours/pXX-*.js
  scripts/run-mohamed-suite.js
```

`payments/flow.js` reste le lieu de la transaction SQL de confirmation (ledger, créneaux, ligne `paiements`). On n’en duplique pas la comptabilité. `reservationWorkflow` et `paymentConfirmation` l’appellent.

### 2.2 Ports

Chaque port a une implémentation réelle et une implémentation d’espion.

| Port | Méthodes | Prod |
|---|---|---|
| `notifications` | `confirmationJoueur(id)`, `confirmationGerant(id)`, `pushJoueur(id)`, `pushGerant(id, url)` | `notificationService`, `pushService` |
| `realtime` | `publish(terrainId, type, payload)` | `realtimeHub.notifyTerrain` |
| `gateway` | `statutPaiement(ref) → paid \| pending \| failed` | PayTech / PayDunya, mockable |
| `alerts` | `admin(code, details)` | `bugAlertService` |
| `sessions` | `load`, `save`, `health(openwaId)` | table `openwa_sessions` + HTTP OpenWA |

Les tests unitaires et de parcours n’ouvrent aucune socket vers OpenWA, PayTech ou PayDunya.

---

## 3. Machine à états — réservation

Statut canonique des **nouvelles** réservations joueur en ligne : `en_attente_paiement`.

```
                    création joueur (politique avance)
                    ┌─────────────────────────┐
                    │  en_attente_paiement    │
                    │  verrou_expire_at = now │
                    │  + delai (défaut 15 min)│
                    │  code = null, qr = null │
                    └───────────┬─────────────┘
            IPN success         │         verrou expiré        IPN cancel / abandon
            ┌───────────────────┼───────────────────┐
            v                   v                   v
       confirme              expire              annule
       code + QR signé       créneaux libres     créneaux libres
            │
            │ scan dans la fenêtre, signature OK, pas déjà scanné
            v
       match_joue
       qr_code_scanne_at renseigné (irréversible — lot v2.1)
```

Branches qui **ne passent pas** par `en_attente_paiement` :

| Origine | Statut immédiat | QR | WhatsApp confirmation | Lien PayTech |
|---|---|---|---|---|
| Gérant, politique `sans_avance` | `confirme` | oui, signé | oui, joueur + push | non |
| Gérant, mode `bloquer` (manuel) | `confirme` | oui, signé | selon le flux gérant déjà en place | non |
| Gérant, mode paiement (avance) | `en_attente_paiement` | non | non (lien de paiement seulement, flux actuel) | oui |

Transitions interdites (la fonction retourne une erreur métier, aucune écriture) :

- `annule` → `confirme`
- `expire` → `confirme`
- `match_joue` → `confirme`
- `confirme` → `en_attente_paiement`
- second passage `confirme` pour la même `ref_command`

`en_attente` (legacy) est **accepté en entrée** de la confirmation IPN, au même titre que `en_attente_paiement`. Il n’est plus écrit par les nouvelles créations joueur.

Créneaux (`creneaux.statut`) : `en_attente_paiement` pendant le verrou, `reserve` (ou statut déjà produit par `confirmerCreneauxReservation`) une fois confirmé, `libre` à l’expiration ou à l’annulation.

---

## 4. Spécification fonctionnelle

### US-05 — Le paiement est le seul déclencheur

**Acteur :** système, joueur.

- Création `POST /api/reservations` (rôle joueur, terrain en politique avance) : statut `en_attente_paiement`, `code_reservation` null, `qr_code_payload` null, aucun appel à `envoyerConfirmation`.
- Le créneau est verrouillé dans la même transaction (`lockCreneauxAtomique`).
- IPN success est le seul événement qui passe cette réservation à `confirme` et qui enqueue les notifications.
- La machine est le module `domain/reservationState.js`. Toute route qui change un statut passe par lui.

**Déjà conforme, à conserver :** `confirmerPaiementEtNotifier` n’est pas appelé à la création joueur. Le lien PayTech, lui, est créé après insert quand `mode === 'paiement'` — ce comportement reste.

### US-01 — Confirmation après vrai paiement

**Acteur :** joueur, gérant, admin.

Quand l’IPN PayTech ou PayDunya est un succès pour une réservation :

1. Statut → `confirme`, `confirme_at` renseigné une seule fois.
2. Ligne `paiements` → `paye` (ou insert si pas de pending), une seule fois pour la référence.
3. Créneaux confirmés via `confirmerCreneauxReservation`.
4. Code `TF-xxxxxx` + payload QR **signé**.
5. Ledger `appliquerApresPayin` inchangé.
6. Notifications, dans cet ordre, chacune non bloquante pour les autres :
   - WhatsApp joueur (`envoyerConfirmation`) — obligatoire métier ; si l’envoi échoue, la résa **reste confirmée** et le message va dans `notification_retry_queue`.
   - Push joueur.
   - Notification gérant : WhatsApp si session prête, sinon file ; push ; événement SSE (US-06).
7. Deuxième IPN, même référence ou résa déjà `confirme` : action `already_confirmed`, zéro nouveau WhatsApp, zéro nouveau `dus`, zéro nouveau code.
8. IPN success mais créneau plus disponible : chemin `refund` existant (annulation + `envoyerRemboursement`) conservé.
9. IPN absent : job `ipnReconciliation`. Une réservation `en_attente_paiement` avec paiement `en_attente` plus vieux que le seuil (`IPN_RECONCILE_AFTER_MS`, défaut 3 min en test, configurable) interroge `gateway.statutPaiement`.
   - `paid` → même fonction que l’IPN.
   - `failed` → pas de confirmation, alerte admin `ipn_echec`.
   - `pending` → retry, max 3, puis alerte admin `ipn_muet`.
10. Réservation inconnue : `missing`, aucune écriture.

Les IPN abonnement, achat définitif et dette (`confirmerAbonnementDepuisIpn`, `confirmerAchatDepuisIpn`, `confirmerDetteDepuisIpn`) ne changent pas de comportement.

### US-03 — Compte réellement persisté

**Acteur :** joueur.

`authAccountService` reprend la logique actuelle de `/api/auth/register`, verify OTP et login.

- `register` : insert `users` (`role=joueur`, `is_active=1`, `telephone_verified=0`) **ou** update du même `id` si le téléphone existe et n’est pas vérifié. Jamais de second compte pour le même numéro.
- Téléphone déjà vérifié → erreur métier 409.
- Pas de JWT tant que l’OTP n’est pas vérifié.
- OTP valide → `telephone_verified=1`, JWT dont `id` (ou `sub`) est **cet** `users.id`.
- Login ultérieur avec les mêmes identifiants → même `id`.
- `GET /api/auth/me` renvoie le nom, le prénom et le téléphone de cette ligne, jamais ceux d’un autre `id`.
- Chaque register, verify succès, verify échec, login succès, login échec écrit une ligne `auth_audit` : `user_id` nullable, `action`, `telephone_masque` (9 chiffres tronqués, pas le mot de passe), `ip`, `created_at`.
- Le mot de passe et le code OTP ne sont jamais loggés.

### US-06 — Le gérant est notifié d’une résa confirmée

**Acteur :** gérant.

Uniquement après transition réussie vers `confirme` (IPN ou sans avance) :

- `realtime.publish(terrainId, 'reservation_confirmee', { reservation_id, code, statut: 'confirme' })`.
- Push compte gérant (`employe`) avec URL produite par `lib/gerantDeepLink.js` : chemin backoffice gérant, ou préfixe `/pro` quand l’environnement mono-host est actif (`GERANT_MONO_HOST=1`).
- WhatsApp gérant si `sessions.health` est up ; sinon file retry. L’événement SSE part dans les deux cas.
- Une réservation encore `en_attente_paiement` ne publie pas `reservation_confirmee`.
- L’événement d’un terrain A n’est pas délivré aux abonnés du terrain B (`realtimeHub` filtre déjà par id ; le test le fige).

### US-08 — Créneau bloqué 15 minutes

**Acteur :** joueur.

- À la création, le verrou est celui du terrain : `normaliserDelaiVerrouPaiementMin(delai_verrou_paiement_min)`, défaut 15, borné 1..120.
- Un second joueur sur un créneau qui chevauche (même partiellement) une réservation `en_attente_paiement` ou `en_attente` legacy dont `verrou_expire_at > now`, ou une réservation `confirme` / `acceptee`, reçoit 409 `CRENEAU_CONFLIT`.
- `libererVerrousExpires(now)` : réservations dont le verrou est passé et le statut est `en_attente_paiement` ou `en_attente` → `expire`, créneaux repassent `libre`. Appelée au début de `lockCreneauxAtomique` et par le cron existant.
- Une réservation `confirme` n’expire jamais par ce job.
- Le mode gérant `bloquer` / sans avance ne pose pas `verrou_expire_at`.
- La disponibilité exposée au joueur (`creneauService` / `terrainBookingAvailability`) marque ce créneau indisponible tant que le verrou tient.

### US-10 — Sessions OpenWA durables

**Acteur :** opérateur, superadmin.

Table `openwa_sessions` :

| Colonne | Rôle |
|---|---|
| `session_key` | PK logique (`platform`, clé gérant) |
| `openwa_id` | id distant |
| `status` | `down` \| `pairing` \| `ready` |
| `last_qr` | nullable |
| `last_error` | nullable |
| `updated_at` | horodatage |

- Démarrage processus : relecture de la table, healthcheck, reconnexion si `openwa_id` connu et health OK.
- QR au-delà de `PAIRING_TTL_MS` : statut `pairing` périmé, nouvel essai, jamais `ready`.
- Health down après retry : `status=down`, `alerts.admin('openwa_down', …)`.
- `WHATSAPP_MOCK=true` : envoi `{ mocked: true, ok: true }`, statut public `mock: true`, `readyForProd: false`. Aucune écriture « ready » issue du mock ne doit mentir en prod.
- `reloadConfig()` ne recolle pas l’id de session plateforme sur une session gérant (règle déjà présente dans `whatsappClient.js`, à figer par test).

### US-12 — L’UI lit l’état réel

**Acteur :** gérant, superadmin. Le front consommera ; ici seule l’API.

- `GET /api/whatsapp/status` lit `openwa_sessions` + dernier health. Une `Map` mémoire `ready` avec une ligne `down` répond `connected: false`.
- Changement d’état : un seul event `whatsapp_status` `{ connected, session_key }`.
- `POST /api/whatsapp/reconnect` (auth superadmin ou gérant de sa session) met à jour la même table.
- Sans `OPENWA_API_KEY`, `config.readyForProd` reste false.
- Un simple GET ne crée pas de ligne fantôme `ready`.

### US-14 — Réservation gérant sans avance

**Acteur :** gérant, joueur.

Si `politique_paiement` du terrain est `sans_avance` ou `sans_acompte` :

- Création gérant → `confirme` immédiat, `montant_avance = 0`, `mode_paiement = 'sans_avance'`.
- Dette commission via `creerDettePourReservation` (source `sans_avance`) conservée, y compris `avance_reference`.
- WhatsApp confirmation joueur + push joueur.
- `lien_paiement` et `redirect_url` absents ou null. `paytechService.creerLienPaiement` n’est pas appelé.
- QR signé présent (la résa est confirmée).
- Le même service, sur un terrain `avance`, ne confirme pas et n’envoie pas la confirmation WhatsApp.

Le parcours joueur en ligne sur un terrain sans avance suit la même branche : confirmé, notifié, sans lien. S’il existe aujourd’hui un forçage `mode = bloquer` dans `creerReservationAvecPaiement`, on le conserve comme mécanisme interne, le statut et les notifications doivent respecter le tableau de la section 3.

### US-16 — QR aligné sur le workflow et sur le lot v2.1

**Acteur :** joueur, gérant.

- Payload généré **seulement** au moment où le statut devient `confirme` (IPN ou sans avance / bloquer).
- Format : JSON actuel (`reservation_id`, `code`, `creneau_id`, `terrain_id`, `expire_at`) + champ `sig` HMAC-SHA256 sur la chaîne canonique triée, secret `QR_HMAC_SECRET`. En absence de secret au boot prod : refus de signer, log erreur, pas de payload vide silencieux en prod. En test, secret fourni par l’environnement du harness.
- `expire_at` = fin de fenêtre `calculerFenetreCheckIn` (début = heure début − 1 h, fin = heure fin + retard + 2 h). On ne change pas cette formule.
- Scan (`gerantCheckin` / `assertQrMatchesReservation`) refuse, sans passer à `match_joue` :
  - signature absente ou fausse → `QR_INVALID`
  - id, code, créneau ou terrain différents → `QR_MISMATCH` ou `QR_WRONG_TERRAIN` (404 côté isolation terrain, comme le lot v2.1, pour ne pas révéler une résa d’un autre terrain)
  - statut ≠ `confirme` → 400
  - `qr_code_scanne_at` déjà rempli → 403, message avec date/heure du premier scan
  - hors fenêtre → `QR_SCAN_TOO_EARLY` / `QR_SCAN_EXPIRED`
- Scan valide : `match_joue`, `qr_code_scanne_at`, log `qr_scanne`, `realtime.publish(..., 'checkin', ...)`.
- `parseQrPayload` continue d’accepter le texte legacy `TF-…` pour diagnostic. Le **scan** exige la signature. Ce durcissement est voulu et couvert par un test de parcours.
- `maskCodeReservationForJoueur` continue de retirer code et QR tant que le statut est `en_attente` ou `en_attente_paiement`. `GET /api/reservations/mes` peut renvoyer la ligne (le masquage carte est US-04, front) mais sans secret de check-in.

### US-19 — Photos téléphone

**Acteur :** superadmin.

- Entrées acceptées : `image/jpeg`, `image/png`, `image/webp`, `image/heic`, `image/heif`, en data URL et via le flux multer déjà branché sur l’upload terrain.
- HEIC/HEIF convertis en JPEG avant écriture disque. Les autres types autorisés restent dans leur extension.
- Refus 400, message explicite : mime interdit, base64 illisible, fichier vide, fichier > 5 Mo (`MAX_IMAGE_BYTES`).
- Terrain inconnu → 404.
- `syncTerrainPhotos` et l’ordre `est_principale` restent identiques.

### US-21 — Prix affiché sur la carte d’accueil

**Acteur :** superadmin (écriture), joueur (lecture publique).

- Colonne `terrains.prix_carte_source` : `'demi'` (défaut) ou `'entier'`.
- Lecture publique du terrain ajoute `prix_affiche` (nombre) et `prix_carte_source`.
- Résolution (`domain/prixCarte.js`) : source demandée → prix du format correspondant ; format absent → l’autre format s’il existe ; sinon `prix_heure` du terrain ; sinon `null`.
- `PATCH` admin (route configs terrain existante, corps `{ prix_carte_source }`) valide l’enum, persiste, incrémente la version (US-23), publie `tarifs`.
- Valeur hors enum → 400.
- **Invariant :** `calculerPrixReservation` ignore `prix_carte_source`. Le prix payé reste le prix du format choisi à la réservation.

### US-23 — Configs propagées

**Acteur :** superadmin, joueur, gérant.

- Colonne `terrains.config_version` entier, défaut 0.
- Tout PATCH de prix carte, commodités ou flags métier déjà exposés incrémente cette colonne de 1 dans la même transaction que la donnée.
- `realtime.publish(terrainId, 'config_updated', { version })`.
- GET public : en-tête `ETag: W/"<config_version>"`. `If-None-Match` égal → 304 sans corps.
- Un GET ne modifie pas la version.
- Un événement `reservation_confirmee` ne modifie pas `config_version`.

### US-25 — Anti-abus

**Acteur :** système.

Politique pure dans `domain/rateLimitPolicy.js`, branchée sur le middleware existant.

| Clé | Fenêtre | Plafond | Comptage |
|---|---|---|---|
| `auth` login | 15 min | 5 échecs | échecs seulement ; succès vide le seau |
| `otp` | 15 min | 5 | chaque demande |
| `reservation` create | 10 min | 10 | chaque création |

- Au-delà : HTTP 429, corps `{ error: 'Trop de tentatives. Veuillez reessayer plus tard.' }` (message déjà servi, stable pour le front US-26).
- Lockout progressif : à chaque blocage atteint, la fenêtre suivante pour cette clé est doublée, plafond 1 h.
- Chaque 429 écrit `auth_audit.action = 'rate_limited'` avec la clé de famille (`auth` / `otp` / `reservation`), pas le mot de passe.
- Hors `NODE_ENV=production` et hors `AUTH_RATE_LIMIT=1` / `RATE_LIMIT=1`, le middleware laisse passer (comportement actuel). Les tests de cette story forcent le flag.
- Validation d’entrée actuelle (`validate.js`) reste devant l’insert : date invalide, mot de passe trop court, OTP non numérique ne créent aucune ligne.
- Helmet déjà dépendant : la réponse de l’app inclut `X-Content-Type-Options: nosniff`. On ne durcit pas la CSP au point de casser le front dans cette story ; on fige l’en-tête nosniff par test.

### US-28 — Fixtures pour les parcours

**Acteur :** développeur, campagne US-27 (front).

- `scripts/seed-e2e.js` : un compte joueur, gérant, propriétaire, superadmin, un terrain avance, un terrain sans avance, mots de passe et téléphones **constants** documentés en tête du script. Second passage : mêmes identifiants, pas de doublon.
- Ce seed écrit dans `DB_PATH` courant. Il ne lance pas `seed.js` démo et ne supprime pas les comptes Abdou Sow lorsqu’on l’exécute sur une autre base. Les tests utilisent toujours un fichier sqlite temporaire.
- Routes montées **uniquement** si `E2E_MODE=1` :
  - `POST /api/test/reset` — remet le jeu e2e minimal.
  - `POST /api/test/simulate-payment` corps `{ reservation_id }` — appelle la confirmation domaine, sans prestataire. Refus si statut `annule` ou `expire` ou `match_joue`.
- Sans le flag, ces chemins répondent 404.

### Support hors assignation directe

- **US-02 :** si `GET /api/auth/me` ne renvoie pas l’`id` créé par US-03, le correctif est dans `authAccountService` / middleware JWT. Pas de travail front ici.
- **US-27 :** les fixtures US-28 sont le contrat backend. Pas de scénario Playwright dans ce lot.

---

## 5. Spécification technique transverse

### 5.1 Schéma (ajouts seulement)

`addColumnIfMissing` / `CREATE TABLE IF NOT EXISTS` dans `database.js`, comme le reste du projet.

- `auth_audit (id, user_id, action, telephone_masque, meta, ip, created_at)`
- `openwa_sessions (session_key PK, openwa_id, status, last_qr, last_error, updated_at)`
- `ipn_reconciliation (id, reservation_id, ref_command, attempts, status, last_error, updated_at)` avec unicité `(reservation_id, ref_command)`
- `terrains.prix_carte_source TEXT DEFAULT 'demi'`
- `terrains.config_version INTEGER DEFAULT 0`

Aucune suppression de colonne. `en_attente` reste un statut lisible.

### 5.2 Contrats HTTP touchés

| Méthode | Chemin | Changement |
|---|---|---|
| POST | `/api/auth/register` | délègue à `authAccountService` + audit |
| POST | `/api/auth/verify-otp` et login | idem, JWT lié au `user_id` |
| GET | `/api/auth/me` | profil du `user_id` du token |
| POST | `/api/reservations` | statut `en_attente_paiement`, pas de QR |
| POST | `/api/reservations/gerant` et `/api/gerant/reservations` | branche sans avance notifie ; avance ne confirme pas |
| POST | webhook IPN existants | passent par la confirmation idempotente |
| GET | `/api/whatsapp/status` | DB + health |
| POST | `/api/whatsapp/reconnect` | met à jour la DB |
| PATCH | config terrain (prix carte) | colonne + version + SSE |
| GET | fiche terrain publique | `prix_affiche`, `ETag` |
| POST | `/api/test/*` | 404 sauf `E2E_MODE=1` |

Les codes d’erreur métier existants (`CRENEAU_CONFLIT`, `QR_INVALID`, `QR_MISMATCH`, `QR_WRONG_TERRAIN`, 409 téléphone, 429) sont conservés. On ajoute `QR_HORS_FENETRE` seulement s’il n’est pas déjà couvert par `QR_SCAN_TOO_EARLY` / `QR_SCAN_EXPIRED` — dans ce cas on **réutilise** ces deux codes.

### 5.3 Observabilité

- Échec de notification après confirmation : `logger.error`, réservation non rollback.
- Alerte admin : `ipn_echec`, `ipn_muet`, `openwa_down`.
- Audit auth et audit gérant restent deux tables.

### 5.4 Ce qu’on ne fait pas

- Pas de réécriture de `index.js` en microservices.
- Pas de changement des formules de prix, de commission, de fenêtre de check-in, de remboursement.
- Pas d’UI, pas de liens `wa.me`, pas de filtre « Mes réservations » côté React.
- Pas d’appel réseau réel dans les tests.
- Pas de modification de `seed.js` démo pour y mélanger les comptes e2e.

---

## 6. Stratégie de tests

Deux niveaux, même harness (`backend/test/helpers/harness.js`), base sqlite temporaire (`DB_PATH` dans l’os tmpdir), `WHATSAPP_MOCK` inutile parce que les ports sont des espions.

Un parcours n’est pas un test bout-en-bout navigateur. C’est un **enchaînement métier dans le processus**, avec la vraie base et les vrais modules domaine, et des espions à la place du réseau.

### 6.1 Unitaires — une règle

| Fichier | Règles figées |
|---|---|
| `test/unit/us05-state-machine.js` | transitions autorisées / interdites ; création joueur sans QR et sans confirmation |
| `test/unit/us01-ipn.js` | confirm, double IPN, WhatsApp qui throw, réconciliation paid / failed / pending, `missing` |
| `test/unit/us03-auth.js` | insert, 409, réinscription même id, OTP, JWT id, audit sans secret |
| `test/unit/us06-gerant-notify.js` | SSE du bon terrain, deep-link, session down → file + SSE quand même |
| `test/unit/us08-lock.js` | 409 chevauchement, expiration, délai 30, borne 1..120, `confirme` non expiré |
| `test/unit/us10-openwa.js` | reload DB après « reboot » simulé, health down, mock ≠ readyForProd, QR périmé |
| `test/unit/us12-wa-status.js` | mémoire ready + DB down → `connected false` ; un event par transition ; GET ne crée pas de ligne |
| `test/unit/us14-sans-avance.js` | confirmé, avance 0, pas de lien, dette présente, terrain avance non confirmé par ce chemin |
| `test/unit/us16-qr.js` | pas de payload avant confirm ; signature ; altération ; hors fenêtre ; mauvais terrain ; déjà scanné |
| `test/unit/us19-photos.js` | jpeg/png/webp/heic acceptés ; gif refusé ; > 5 Mo ; terrain inconnu |
| `test/unit/us21-prix-carte.js` | défaut demi ; fallback ; PATCH ; enum invalide |
| `test/unit/us23-config-events.js` | version +1 ; ETag 304 ; GET n’incrémente pas |
| `test/unit/us25-ratelimit.js` | 429 au plafond ; succès vide le seau ; fenêtre doublée ; validation avant insert |
| `test/unit/us28-fixtures.js` | seed idempotent ; simulate-payment ; 404 sans `E2E_MODE` |

### 6.2 Parcours — enchaînements

Chaque parcours utilise `fixtureDb` (un terrain avance, un terrain sans avance, un gérant, deux joueurs) et les espions. Il échoue si une étape intermédiaire a un effet interdit (QR trop tôt, double notif, profil croisé).

| Id | Enchaînement | Assertions de bout de chaîne |
|---|---|---|
| P-01 | Joueur crée une résa → autre joueur vise le même créneau → horloge après 15 min → le second crée | 409 puis succès ; la première est `expire` ; aucun WhatsApp de confirmation |
| P-02 | Joueur crée → IPN success | `confirme`, un WhatsApp joueur, un push joueur, un SSE `reservation_confirmee`, un QR signé, un `dus` |
| P-03 | P-02 puis le même IPN rejoué | compteurs de notif inchangés, un seul paiement `paye`, un seul code |
| P-04 | Joueur crée → pas d’IPN → job, gateway `paid` | même état final que P-02, `attempts >= 1` |
| P-05 | Joueur crée → job, gateway `failed` trois fois | statut reste `en_attente_paiement`, alerte `ipn_echec` ou `ipn_muet`, pas de QR |
| P-06 | IPN success et WhatsApp joueur lève | résa `confirme`, entrée retry, pas d’`annule` |
| P-07 | Register « Babacar Sène » → OTP → token → `/me` → second register autre numéro → `/me` de chaque token | profils isolés ; téléphone vérifié ; deux lignes `users` |
| P-08 | Register → mauvais OTP → login | `telephone_verified` reste 0 ; pas de JWT de ce compte |
| P-09 | Gérant crée sur terrain sans avance | `confirme`, dette, WhatsApp confirmation, `lien_paiement` null, SSE gérant |
| P-10 | Gérant crée en mode paiement (avance) | `en_attente_paiement`, lien présent, **pas** de WhatsApp confirmation, pas de SSE `reservation_confirmee` |
| P-11 | P-02 → scan dans la fenêtre → second scan | `match_joue`, 403 au second scan, event `checkin` une fois |
| P-12 | P-02 → scan hors fenêtre, puis QR altéré, puis QR d’un autre terrain | trois refus, statut reste `confirme` |
| P-13 | Résa non payée → tentative de lecture payload de scan | pas de signature exploitable |
| P-14 | Session OpenWA sauvegardée → nouveau store qui relit la DB → health OK | `connected true` ; health KO → alerte, `connected false` |
| P-15 | PATCH `prix_carte_source=entier` → GET public avec ETag | `prix_affiche` change, version +1, second GET 304 ; `calculerPrixReservation` sur le même terrain pour une résa `moitie` ne suit pas le prix carte |
| P-16 | Cinq logins faux puis un sixième, puis un login vrai après reset de politique succès sur un autre essai sous plafond | 429 ; le succès sous plafond n’est pas 429 ; `auth_audit` contient `rate_limited` |
| P-17 | `E2E_MODE=0` appelle simulate-payment ; puis `E2E_MODE=1`, seed, création, simulate | 404 puis `confirme` |
| P-18 | Annulation prestataire après création | `annule`, créneau libre, le joueur suivant réserve, aucun QR |

P-02 est le parcours de référence « argent non perdu ». P-03 est le parcours de référence « pas de double confirmation ».

### 6.3 Non-régression de l’existant

`scripts/run-mohamed-suite.js` enchaîne :

1. `test/unit/us*.js`
2. `test/parcours/p*.js`
3. les scripts déjà verts et concernés : `test-reservation-lock.js`, `test-paytech-payin-unit.js`, `test-paydunya-ipn.js`, `test-otp-auth.js`, `test-checkin-rules.js`, `test-pricing.js`, `test-kanban-rules.js`

Un parcours nouveau qui casse un de ces scripts est un échec de la story, pas une mise à jour silencieuse du script ancien. Si un script ancien encodait le défaut « QR dès la création », on le met à jour **explicitement** dans la story US-16 et le diff du script fait partie du contrat (l’ancienne assertion est remplacée par « QR null tant que non confirmé »).

### 6.4 Définition de fini

Une story est finie lorsque :

- ses tests unitaires passent ;
- les parcours qui la citent passent ;
- la suite Mohamed complète passe, y compris les scripts historiques listés ;
- aucun secret, OTP ou mot de passe n’apparaît dans `auth_audit` ni dans les logs d’échec de test ;
- le comportement legacy `en_attente` → IPN → `confirme` reste vrai (couvert dans US-01).

---

## 7. Ordre d’implémentation

L’ordre est celui des dépendances, pas un calendrier.

1. Harness : `fixtureDb`, `spies`, `run-mohamed-suite.js` (squelette qui échoue tant que les fichiers manquent).
2. `reservationState` + US-05, parcours P-01 et P-10.
3. Confirmation idempotente + réconciliation + QR signé à la confirmation : US-01 et US-16 (le QR naît au même endroit que la confirmation), parcours P-02, P-03, P-04, P-05, P-06, P-12, P-13, P-18.
4. Auth extraite + audit : US-03, parcours P-07, P-08.
5. SSE / push / deep-link gérant : US-06, assertions ajoutées à P-02 et P-09.
6. Expiration de verrou alignée sur `en_attente_paiement` : US-08, P-01.
7. Store OpenWA puis statut API : US-10, US-12, P-14.
8. Sans avance notifié : US-14, P-09.
9. Scan `match_joue` + signature : fin de US-16, P-11.
10. Photos, prix carte, version de config : US-19, US-21, US-23, P-15.
11. Rate-limit : US-25, P-16.
12. Seed et routes e2e : US-28, P-17.

Chaque étape ne merge sa logique qu’avec ses tests dans le même changement. Les stories suivantes réexécutent toute la suite.

---

## 8. Critères d’acceptation globaux

- Un joueur qui paie vraiment obtient une réservation `confirme`, un WhatsApp (ou une entrée de retry), un push, et le gérant reçoit SSE + push, que l’IPN arrive par webhook ou par réconciliation.
- Un double IPN ne double ni l’argent comptable (`dus`, `paiements`) ni les messages.
- Un joueur qui ne paie pas n’a ni code, ni QR signé, ni message de confirmation. Son créneau se libère à l’échéance du verrou.
- Deux comptes créés l’un après l’autre ne partagent pas leur profil au `/me`.
- Une session OpenWA survit à une nouvelle instance de store qui relit la base.
- Un terrain sans avance confirme sans lien de paiement et notifie le joueur.
- Un scan ne valide que un QR signé, confirmé, dans la fenêtre, non déjà scanné, sur le terrain du gérant.
- Le prix carte et le prix de réservation sont deux données distinctes.
- Les abus de login / OTP / création produisent un 429 stable et une ligne d’audit.
- `E2E_MODE` éteint, les routes de simulation n’existent pas.
