# Déploiement Render — TerrainSN (plan gratuit)

## Cause de l’échec précédent

Render a lancé un service **Node** avec `yarn` / `yarn start`, mais la racine n’avait **pas** de script `start` ni de build des frontends.

C’est corrigé : `npm start` + `npm run build:render`.

## Option A — Service déjà créé (ton cas)

Dans le dashboard Render → ton service → **Settings** :

| Champ | Valeur |
|-------|--------|
| **Build Command** | `npm run build:render` |
| **Start Command** | `npm start` |

Puis **Environment** → variables de base :

| Key | Value |
|-----|-------|
| `NODE_ENV` | `production` |
| `JWT_SECRET` | une longue chaîne aléatoire |
| `JWT_REFRESH_SECRET` | une autre chaîne aléatoire |
| `SKIP_SEED` | `true` (**obligatoire** en prod — évite le `seed.js` bulk) |
| `FORCE_SEED` | `false` (ne jamais mettre `true` en prod) |

> **DB Render free = éphémère.** Même avec `SKIP_SEED=true`, le boot rejoue toujours les ensures idempotents :
> Mohamed, joueur Babacar, **et le seed multi-terrains** (`multi.gerant@terrainsn.sn` / `password123`).
> La démo CA / 3 terrains revient donc après chaque machine neuve / redeploy.
| `COOKIE_SAMESITE` | `lax` |
| `APP_DOMAIN` | `https://terraisn1-1.onrender.com` (domaine prod canonique) |
| `APP_DOMAIN_JOUEUR` | `https://terraisn1-1.onrender.com` |
| `APP_DOMAIN_PRO` | `https://terraisn1-1.onrender.com/pro` |
| `CORS_ORIGINS` | `https://terraisn1-1.onrender.com` |

**Manual Deploy** → **Deploy latest commit**.

> Ne laisse pas Build = `yarn` et Start = `yarn start`.
> Ne jamais remettre `terrainsn.onrender.com` (404) ni `terrainsn.com` comme domaine app.

## Paiements en production (PayTech)

| Key | Value |
|-----|-------|
| `PAYTECH_MOCK` | `false` |
| `PAYMENT_MODE` | `production` |
| `PAYMENT_PROVIDER` | `paytech` |
| `PAYTECH_ENV` | `prod` |
| `PAYTECH_API_KEY` | clé live PayTech |
| `PAYTECH_API_SECRET` | secret live PayTech |
| `PAYTECH_IPN_URL` | `https://terraisn1-1.onrender.com/webhook/paytech` |
| `PAYTECH_SUCCESS_URL` | `https://terraisn1-1.onrender.com/paytech/success` |
| `PAYTECH_CANCEL_URL` | `https://terraisn1-1.onrender.com/paytech/cancel` |

`APP_DOMAIN` sert aussi pour IPN/success/cancel. Vérif : `GET /health` → `payment.readyForProd: true` et `appDomain` = `https://terraisn1-1.onrender.com`.

**Aussi en Super Admin → Intégrations** : les valeurs DB écrasent le `.env` au boot. Au démarrage, l’API réaligne automatiquement les URLs PayTech sur `APP_DOMAIN` si un ancien host (ex. `terrainsn.onrender.com`) est encore en base.

## Retraits gérants (payouts)

| Key | Value |
|-----|-------|
| `PAYTECH_PAYOUT_ENABLED` | `true` **uniquement** si PayTech a autorisé les payouts |
| `WHATSAPP_DEV_NUMBER` | numéro SN équipe (alertes retraits manuels) |

Laisser `PAYTECH_PAYOUT_ENABLED=false` tant que les payouts ne sont pas autorisés (file manuelle + WhatsApp dév).

### Checklist contrat terrain (sinon payin OK / payout bloqué)

1. Super Admin → terrain → onglet paiement : Wave **ou** OM **vérifié**
2. Activer **Production paiement** (`paiement_production=1`) pour le mode **auto**
3. Mode **retrait** : le gérant clique **Retirer** dans Finances (`/pro`), puis admin traite dans **Caisse**
4. Mode **auto** : attendre la fin de fenêtre de remboursement ; vérifier `raison_blocage` sur le portefeuille gérant / file payable

### Runbook smoke prod

1. `GET https://terraisn1-1.onrender.com/api/health` → `payment.readyForProd: true`, `payouts.paytechEnabled` cohérent
2. Joueur : réserver + payer Wave/OM → page succès passe à **Confirmé** (IPN)
3. Ledger : un `dus` créé (`en_fenetre` ou `payable`)
4. Auto : après fenêtre → payout `envoye` **ou** message `pas_en_production` / canal
5. Retrait : gérant **Retirer** → Caisse **Envoyer**

## WhatsApp en production

| Key | Value |
|-----|-------|
| `WHATSAPP_MOCK` | `false` |
| `OPENWA_API_KEY` | clé OpenWA |
| `OPENWA_BASE_URL` | `https://mywa.tickets-place.net` |
| `OPENWA_SHARED_SESSION_ID` | UUID session déjà connectée |
| `WHATSAPP_DEV_NUMBER` | numéro équipe (optionnel mais recommandé) |

## Web Push (notifications navigateur)

| Key | Value |
|-----|-------|
| `VAPID_PUBLIC_KEY` | généré via `node backend/scripts/generate-vapid-keys.js` |
| `VAPID_PRIVATE_KEY` | idem |
| `VAPID_SUBJECT` | `mailto:contact@terrainsn.com` |

Sans clés env, le serveur **auto-génère** et persiste près de la DB — OK pour démarrer, mais **fixe les clés en env** pour survivre aux machines Render free.

## Favoris

API `/api/favoris` (joueur connecté) — sync multi-appareils. Hors connexion : cache localStorage.

## Option B — Nouveau Blueprint

1. Push branche `MOHAMED_COULIBALY`
2. **New** → **Blueprint** → Apply
3. Renseigner les secrets (`sync: false`)

## URLs

| Surface | Chemin |
|---------|--------|
| Health | `/health` |
| WhatsApp status | `/api/whatsapp/status` |
| WhatsApp QR | `/whatsapp-qr` |
| Favoris | `/api/favoris` |
| IPN PayTech | `/webhook/paytech` |

## Limites du plan gratuit

- **Pas de disque** : SQLite + uploads + VAPID fichier peuvent être perdus au redeploy → plan **Starter** + Docker + volume `/data`.
- Cold start ~30–60 s.
- WhatsApp : préférer `OPENWA_SHARED_SESSION_ID`.

## Re-seed forcé

`FORCE_SEED=true` → redeploy une fois → remettre `false`.
