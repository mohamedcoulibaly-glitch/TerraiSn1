# Cahier des charges technique — Mohamed Coulibaly

**Projet :** TerrainSN (Sénégal Foot Résa)  
**Référence globale :** Cahier des charges technique v2.1  
**Lot :** A — Espace Gérant & Anti-fraude QR  
**Branche Git :** `MOHAMED_COULIBALY`  
**Version :** 1.0 — Document de travail personnel

---

## 1. Mission

Tu es responsable de rendre le parcours **gérant / check-in** conforme au CDC v2.1 :

1. Le gérant voit clairement les **réservations du jour**, triées par heure.
2. Il ouvre une **fiche détail** pour chaque réservation.
3. Il scanne le QR **uniquement depuis cette fiche** (plus de scan « sauvage » hors contexte).
4. Un QR scanné passe à `match_joue`, est **horodaté**, et **ne peut plus être rescanné**.
5. Il consulte son **portefeuille** (avances / commissions / reversements).

Tu ne touches **pas** à l’espace joueur, à la géolocalisation, aux templates WhatsApp, ni à l’auth refresh token (lot Babacar).

---

## 2. Périmètre

### 2.1 Inclus (à livrer)

| # | Fonctionnalité | CDC v2.1 |
|---|----------------|----------|
| F1 | API réservations du jour | §7.2, §10 |
| F2 | Onglet / vue « Réservations du jour » | §7.2, §9 |
| F3 | Page `DetailReservation` | §7.1, §9 |
| F4 | Modal `ScannerModal` contextualisée | §7.1, §9 |
| F5 | Endpoint scan anti-fraude + statut `match_joue` | §7, §10, §11 |
| F6 | Page `Portefeuille` gérant | §9 |
| F7 | Sécurisation JWT (terrain du gérant uniquement) | §11 |
| F8 | Dépréciation du scanner libre | §7.1 |

### 2.2 Exclus (ne pas faire)

- Géolocalisation / Haversine / filtres quartier  
- Renommage « acompte » → « avance » dans l’UI joueur  
- Templates WhatsApp officiels  
- Session JWT + refresh_token cookie HTTPOnly  
- Pages propriétaire / super admin (sauf si bug bloquant lié au scan)  
- Refonte complète de `database.js` hors alias statut `match_joue`

### 2.3 Déjà en place (réutiliser, ne pas réécrire)

| Élément | Emplacement | État |
|---------|-------------|------|
| Scanner plein écran + feedbacks | `frontend/.../gerant/Scanner.tsx` | OK — à **refactorer** en modal contextualisée |
| `PATCH /api/gerant/reservations/:id/scanner` | `backend/index.js` | OK partiel — anti-fraude 403 déjà là |
| Fenêtre horaire scan (1h avant → 2h après) | `assertFenetreScanQr` | OK — **conserver** |
| `GET /api/gerant/portefeuille` | `backend/routes/roles.js` | OK — **pas d’UI** |
| `GET /api/reservations/:id` | `backend/index.js` | OK — peut servir la fiche détail |
| Dashboard gérant, créneaux, résas manuelles | pages gerant existantes | OK — à **enrichir** |

---

## 3. Règles métier (anti-fraude)

### 3.1 Cycle de vie d’une réservation (côté scan)

```
en_attente  →  confirme  →  match_joue
                  │              │
                  │              └─ qr_code_scanne_at = NOW()
                  │                 ( irreversible )
                  └─ seul statut scannable
```

| Condition | Résultat attendu |
|-----------|------------------|
| Statut ≠ `confirme` | Erreur 400 — scan refusé |
| `qr_code_scanne_at` déjà renseigné | **403** — *« Ce code QR a déjà été scanné le [Date/Heure] »* |
| QR décodé ≠ ID de la réservation ouverte | Erreur UI — *« QR code non reconnu »* / ne correspond pas à cette fiche |
| Hors fenêtre horaire (trop tôt) | Code `QR_SCAN_TOO_EARLY` — message humain existant |
| Hors fenêtre (trop tard) | Code `QR_SCAN_EXPIRED` — message humain existant |
| Scan OK | Statut → **`match_joue`**, `qr_code_scanne_at` horodaté, log `qr_scanne`, recalcul score |

### 3.2 Statut `match_joue` (migration douce)

Aujourd’hui le code écrit `statut = 'joue'`. Le CDC v2.1 exige `match_joue`.

**À faire :**

1. Dans `marquerReservationJouee`, écrire `match_joue` (ou écrire les deux de façon compatible le temps de la transition).
2. Partout où tu filtres les matchs joués dans **tes** routes gérant, accepter `IN ('joue', 'match_joue')`.
3. Proposer une PR courte sur `database.js` si un CHECK de statut bloque `match_joue` — **Babacar review**.

### 3.3 Isolation terrain (sécurité §11)

Toute lecture / scan doit filtrer :

```sql
WHERE r.id = ? AND r.terrain_id = ?
-- terrain_id = req.user.terrain_id (JWT gérant)
```

Un gérant **ne peut jamais** scanner ni voir le détail d’une réservation d’un autre terrain → **404** (pas 403, pour ne pas fuiter l’existence).

---

## 4. Spécifications API

### 4.1 `GET /api/gerant/reservations/today` — **à créer**

**Auth :** JWT gérant  
**Rôle :** `gerant`

**Comportement :**

- Date = jour local serveur (ou query `?date=YYYY-MM-DD` optionnelle pour debug).
- Filtre `terrain_id = req.user.terrain_id`.
- Statuts utiles au check-in : au minimum `confirme`, éventuellement `match_joue` (grisés / déjà validés).
- Tri strict : `ORDER BY heure_debut ASC` (puis `heure_fin` si égalité).

**Réponse JSON (exemple) :**

```json
{
  "date": "2026-08-03",
  "terrain_id": 2,
  "terrain_nom": "Terrain Parcelles",
  "reservations": [
    {
      "id": 42,
      "code_reservation": "TF-482910",
      "joueur_nom": "Moussa Diallo",
      "joueur_telephone": "+22177XXXXXXX",
      "date": "2026-08-03",
      "heure_debut": "17:00",
      "heure_fin": "18:00",
      "statut": "confirme",
      "montant_total": 70000,
      "montant_avance": 8750,
      "montant_restant": 61250,
      "qr_code_scanne_at": null,
      "type_reservation": "en_ligne"
    }
  ]
}
```

### 4.2 `GET /api/reservations/:id` — **vérifier / enrichir si besoin**

Déjà existant. Pour la fiche gérant, s’assurer que la réponse contient au minimum :

- Identité joueur, créneau, terrain  
- `statut`, `code_reservation`  
- `qr_code_scanne_at`  
- Montants (`montant_avance` / `montant_restant` ou alias legacy)  
- Droit d’accès : gérant du terrain **ou** joueur propriétaire de la résa  

Si l’endpoint actuel est trop permissif ou incomplet pour le gérant, ajouter plutôt :

`GET /api/gerant/reservations/:id`  
(même payload, filtré strictement sur `terrain_id`).

### 4.3 Scan QR — alignement CDC §10

| Action | Spécification |
|--------|----------------|
| Route CDC | `POST /api/reservations/:id/scan-qr` |
| Route actuelle | `PATCH /api/gerant/reservations/:id/scanner` |

**À faire :**

1. **Conserver** la route `PATCH .../scanner` (le front actuel l’utilise).  
2. **Ajouter un alias** `POST /api/reservations/:id/scan-qr` qui appelle la **même** logique.  
3. Harmoniser le message 403 :

```text
Erreur : Ce code QR a déjà été scanné le [Date/Heure]
```

4. Body optionnel :

```json
{ "methode": "especes" }
```

Valeurs : `especes` | `wave` | `orange_money` (défaut `especes`).

5. Succès 200 :

```json
{
  "message": "QR code scanné et match validé",
  "reservation": {
    "id": 42,
    "joueur_nom": "Moussa Diallo",
    "terrain_nom": "Terrain Parcelles",
    "date": "2026-08-03",
    "heure_debut": "17:00",
    "heure_fin": "18:00",
    "code_reservation": "TF-482910",
    "statut": "match_joue",
    "qr_code_scanne_at": "2026-08-03T16:55:12.000Z"
  }
}
```

### 4.4 `GET /api/gerant/portefeuille` — **déjà OK**

Ne pas recréer. Consommer tel quel côté front :

```json
{
  "solde_disponible": 120000,
  "total_encaisse": 250000,
  "total_commission_prelevee": 15000,
  "historique_reversements": [
    { "reservation_id": 42, "montant": 7656, "date": "...", "statut": "effectue" }
  ]
}
```

---

## 5. Spécifications Frontend

### 5.1 Architecture cible (CDC §9)

```
espaces/backoffice/pages/gerant/
├── Dashboard.tsx              ← enrichir : onglet / bloc « Réservations du jour »
├── DetailReservation.tsx      ← À CRÉER
├── Portefeuille.tsx           ← À CRÉER
├── Scanner.tsx                ← déprécier / redirection douce
├── GestionCreneaux.tsx        ← ne pas casser
└── ReservationsManuelles.tsx  ← ne pas casser

espaces/backoffice/components/
└── ScannerModal.tsx           ← À CRÉER (extrait / refactor de Scanner.tsx)

layout/
└── GerantChrome.tsx           ← nav : Jour / Portefeuille ; retirer Scanner libre en fin de lot
```

### 5.2 Routes à ajouter (`AppRouter.tsx`)

| Route | Composant | Accès |
|-------|-----------|--------|
| `/backoffice/gerant` | Dashboard (onglet jour) | gerant |
| `/backoffice/gerant/reservations/:id` | `DetailReservation` | gerant |
| `/backoffice/gerant/portefeuille` | `Portefeuille` | gerant |
| `/backoffice/gerant/scanner` | Redirection → dashboard jour **ou** fallback temporaire | gerant |

> Touche `AppRouter.tsx` **uniquement** pour ajouter ces routes gérant. Pas de routes joueur.

### 5.3 Dashboard — « Réservations du jour » (§7.2)

**Objectif guichet :** voir d’un coup d’œil le match en cours, le suivant, et ouvrir la fiche.

**UI attendue :**

- Titre : **Réservations du jour**  
- Sous-titre : date du jour format FR (`lundi 3 août 2026`)  
- Liste verticale chronologique (`heure_debut`)  
- Chaque ligne :
  - Heure (`17:00 – 18:00`)
  - Nom joueur
  - Code `TF-XXXXXX`
  - Badge statut : `Confirmé` / `Match joué` / autre
- Clic ligne → `/backoffice/gerant/reservations/:id`
- État vide : *« Aucune réservation aujourd’hui »*
- Skeleton loaders pendant le fetch (pas d’écran blanc)
- Mobile-first ; cohérent avec le design system existant (`--color-primary`, `--font-display`, etc.)

**Indication visuelle utile (recommandé) :**

| Situation | Affichage |
|-----------|-----------|
| Créneau en cours (maintenant entre début et fin) | Highlight / bordure primaire |
| Prochain créneau | Badge « Suivant » |
| Déjà `match_joue` | Style muted + check |

### 5.4 `DetailReservation` (§7.1)

**Contenu de la fiche :**

| Bloc | Contenu |
|------|---------|
| En-tête | Code TF, statut badge, bouton retour |
| Joueur | Nom, téléphone (lien `tel:`) |
| Match | Terrain, date, heure début/fin |
| Paiement | Avance payée, reste à payer sur place |
| Anti-fraude | Si déjà scanné → date/heure du scan + pas de bouton scanner |
| Action | Bouton **« Scanner le QR Code »** si `statut === 'confirme'` et `qr_code_scanne_at === null` |

**Comportement bouton Scanner :**

1. Ouvre `ScannerModal` avec `expectedReservationId = id` de la fiche.  
2. La caméra ne valide que si le QR décodé correspond à **cet** ID (ou au `code_reservation` si tu encodes le code — documente le format choisi).  
3. Après succès → fermer modal, recharger la fiche (statut `match_joue`).  
4. Après 403 déjà scanné → message bloquant, pas de re-scan.

### 5.5 `ScannerModal` (§7.1)

Refactorer la logique visuelle de `Scanner.tsx` (cadre vert, ligne de scan, flashs, messages) en **modal / plein écran** déclenchée depuis la fiche.

**Différence critique vs scanner actuel :**

| Scanner libre (actuel) | Scanner contextualisé (cible) |
|------------------------|-------------------------------|
| Accepte n’importe quel QR valide du terrain | Accepte **uniquement** le QR de la réservation ouverte |
| Entrée nav dédiée | Ouvert depuis `DetailReservation` seulement |
| Bouton « Scanner un autre QR » | Bouton « Fermer » / retour fiche après succès |

**États UI à conserver** (déjà bien faits dans `Scanner.tsx`) :

1. Trop tôt → horloge orange + texte avec heure d’ouverture  
2. Expiré → alerte rouge  
3. Succès → flash vert + récap joueur / terrain / horaire / code  
4. Invalide / mauvais QR → flash rouge + *« Ce code ne correspond pas à cette réservation »* (adapter le texte)  
5. Caméra indisponible → message permissions  

**Techno caméra :**

- Réutiliser `BarcodeDetector` si dispo (comme aujourd’hui), **ou** `html5-qrcode` si tu as besoin d’un fallback plus large (mentionné au CDC).  
- Toujours `facingMode: 'environment'` sur mobile.  
- Couper le stream à la fermeture du modal (`getTracks().forEach(stop)`).

### 5.6 `Portefeuille`

**Route :** `/backoffice/gerant/portefeuille`  
**Source :** `GET /gerant/portefeuille`

**Sections :**

1. **Solde disponible** — grand chiffre FCFA  
2. **Total encaissé** / **Commission prélevée** — stats secondaires  
3. **Historique des reversements** — liste (montant, réservation, date, statut)  
4. État vide / skeleton  

Libellés en français familier. Préférer **« avance »** dans les textes UI gérant si tu affiches des montants liés (cohérent CDC), sans refactor DB.

### 5.7 Navigation (`GerantChrome.tsx`)

**Cible fin de lot :**

| Onglet | Route |
|--------|-------|
| Dashboard | `/backoffice/gerant` |
| Créneaux | `/backoffice/gerant/creneaux` |
| Réservations | `/backoffice/gerant/reservations` |
| Portefeuille | `/backoffice/gerant/portefeuille` |
| ~~Scanner~~ | **retiré** (ou feature flag `VITE_GERANT_SCANNER_LIBRE=false`) |

Pendant le développement, tu peux garder le scanner libre en fallback, puis le retirer avant merge final.

---

## 6. Client API (`gerantApi`)

Dans `frontend/src/lib/api.ts`, **section `gerantApi` uniquement** :

```ts
// À ajouter
async reservationsToday(date?: string) {
  const q = date ? `?date=${date}` : '';
  return await request(`/gerant/reservations/today${q}`);
},

async reservationDetail(id: number | string) {
  return await request(`/gerant/reservations/${id}`);
  // ou /reservations/${id} si enrichi et sécurisé
},

async scanQr(id: number | string, methode: 'especes' | 'wave' | 'orange_money' = 'especes') {
  return await request(`/reservations/${id}/scan-qr`, {
    method: 'POST',
    body: JSON.stringify({ methode }),
  });
  // fallback possible : PATCH /gerant/reservations/${id}/scanner
},

async portefeuille() {
  return await request('/gerant/portefeuille');
},
```

Ne pas modifier `authApi`, `terrainsApi`, ni les helpers joueur.

---

## 7. Fichiers autorisés / interdits

### Autorisés

```
frontend/src/espaces/backoffice/pages/gerant/**
frontend/src/espaces/backoffice/layout/GerantChrome.tsx
frontend/src/espaces/backoffice/components/ScannerModal.tsx   (création)
frontend/src/espaces/backoffice/components/BlockSlotModal.tsx (si besoin)
frontend/src/espaces/profil/ProfilGerant.tsx                 (lien portefeuille)
frontend/src/router/AppRouter.tsx                            (routes gérant seulement)
frontend/src/lib/api.ts                                      (gerantApi / reservations scan seulement)

backend/index.js          → blocs /gerant/* , scan-qr, marquerReservationJouee
backend/routes/roles.js   → portefeuille / creneaux gérant
backend/services/auditService.js
backend/services/scoreService.js   (si ajustement statut match_joue)
backend/database.js                → UNIQUEMENT PR courte statut match_joue (review Babacar)
```

### Interdits

```
frontend/src/espaces/joueur/**
frontend/src/auth/**
frontend/src/hooks/use-auth.tsx
backend/notificationService.js
backend/otpService.js
backend/whatsappClient.js
backend/paytechService.js
backend/middleware/auth.js     (sauf accord Babacar)
```

---

## 8. Plan de livraison (3 semaines)

### Semaine 1 — Backend solide

- [ ] `GET /api/gerant/reservations/today`  
- [ ] Alias `POST /api/reservations/:id/scan-qr`  
- [ ] Statut écrit `match_joue` + 403 message CDC  
- [ ] Vérifier filtre `terrain_id` partout  
- [ ] `gerantApi.reservationsToday` + `scanQr`  
- [ ] Commit : `feat(gerant): api today et scan-qr anti-fraude`

### Semaine 2 — Parcours check-in UI

- [ ] Bloc / onglet « Réservations du jour » sur Dashboard  
- [ ] `DetailReservation.tsx` + route  
- [ ] `ScannerModal.tsx` (contexte ID obligatoire)  
- [ ] Brancher succès / erreurs (trop tôt, expiré, déjà scanné, mauvais QR)  
- [ ] Commit : `feat(gerant): check-in fiche et scanner contextualise`

### Semaine 3 — Portefeuille & polish

- [ ] `Portefeuille.tsx` + nav  
- [ ] Retirer / déprécier scanner libre  
- [ ] Skeletons + états vides  
- [ ] Recette complète (checklist §9)  
- [ ] Commit : `feat(gerant): portefeuille et nettoyage nav scanner`

---

## 9. Checklist de recette (definition of done)

### Anti-fraude

- [ ] Scan depuis la fiche d’une résa A avec le QR de la résa B → **refus**  
- [ ] Premier scan OK → statut `match_joue` + `qr_code_scanne_at` rempli  
- [ ] Second scan du même QR → **403** avec date/heure du premier scan  
- [ ] Gérant terrain 1 ne voit / ne scanne pas une résa du terrain 2 → **404**

### Check-in guichet

- [ ] Liste du jour triée par `heure_debut` croissant  
- [ ] Clic → fiche détail complète  
- [ ] Bouton Scanner absent si déjà `match_joue`  
- [ ] Fenêtre horaire trop tôt / trop tard : messages humains conservés

### Portefeuille

- [ ] Solde, total encaissé, commission, historique affichés  
- [ ] Pas de crash si historique vide

### Non-régression

- [ ] Créneaux gérant toujours OK  
- [ ] Réservations manuelles toujours OK  
- [ ] Aucun fichier `espaces/joueur/**` modifié dans ta PR

### Technique

- [ ] Caméra stoppée à la fermeture du modal  
- [ ] Skeleton loaders, pas d’écran blanc  
- [ ] Mobile OK (Chrome Android prioritaire)  
- [ ] Commits préfixés `feat(gerant):` / `fix(scan):`

---

## 10. Comptes de test

Après `npm run setup` / `npm run seed` (mot de passe `password123`) :

| Rôle | Email |
|------|-------|
| Gérant | `sarr@terrainsn.sn` |
| Joueur (pour créer des résas à scanner) | `abdou@email.com` |

**Scénario manuel recommandé :**

1. Se connecter joueur → réserver + confirmer paiement (simulation).  
2. Se connecter gérant → voir la résa dans « du jour ».  
3. Ouvrir fiche → Scanner → valider.  
4. Rescanner → doit échouer.  
5. Ouvrir Portefeuille → vérifier solde / historique.

---

## 11. Conventions Git

```bash
git checkout MOHAMED_COULIBALY
git pull origin main   # régulièrement avant de coder / avant PR
```

- 1 PR = 1 semaine de lot (API → UI check-in → portefeuille)  
- Pas de `--force` sur `main`  
- Si conflit sur `backend/index.js` ou `api.ts` : isoler ta section, prévenir Babacar  
- PR `database.js` (statut) = courte, title clair, demander review Babacar

---

## 12. Résumé en une phrase

> **Mohamed livre le check-in gérant v2.1 : liste du jour → fiche → scan QR unique anti-fraude → portefeuille, sans toucher à l’espace joueur.**

Bon build.
