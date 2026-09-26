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
| `SKIP_SEED` | `false` |
| `COOKIE_SAMESITE` | `lax` |
| `APP_DOMAIN` | `https://<ton-service>.onrender.com` |

**Manual Deploy** → **Deploy latest commit**.

> Ne laisse pas Build = `yarn` et Start = `yarn start`.

## Paiements en production (PayTech)

| Key | Value |
|-----|-------|
| `PAYTECH_MOCK` | `false` |
| `PAYMENT_MODE` | `production` |
| `PAYMENT_PROVIDER` | `paytech` |
| `PAYTECH_ENV` | `prod` |
| `PAYTECH_API_KEY` | clé live PayTech |
| `PAYTECH_API_SECRET` | secret live PayTech |

`APP_DOMAIN` sert aussi pour IPN/success/cancel. Vérif : `GET /health` → `payment.readyForProd: true`.

## Retraits gérants (payouts)

| Key | Value |
|-----|-------|
| `PAYTECH_PAYOUT_ENABLED` | `true` **uniquement** si PayTech a autorisé les payouts |
| `WHATSAPP_DEV_NUMBER` | numéro SN équipe (alertes retraits manuels) |

Laisser `PAYTECH_PAYOUT_ENABLED=false` tant que les payouts ne sont pas autorisés (file manuelle + WhatsApp dév).

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
