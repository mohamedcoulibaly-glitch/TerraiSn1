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

Sans ces variables, le checkout reste en **page simulation locale** (aucun argent réel).

| Key | Value |
|-----|-------|
| `PAYTECH_MOCK` | `false` |
| `PAYMENT_MODE` | `production` |
| `PAYMENT_PROVIDER` | `paytech` |
| `PAYTECH_ENV` | `prod` |
| `PAYTECH_API_KEY` | clé live PayTech |
| `PAYTECH_API_SECRET` | secret live PayTech |

`APP_DOMAIN` (ou `RENDER_EXTERNAL_URL`) sert aussi pour les URLs IPN / success / cancel :
`/webhook/paytech`, `/paytech/success`, `/paytech/cancel`.

Vérif : `GET /health` → `payment.readyForProd: true`, `payment.simulationLocale: false`, `warnings: []`.

> Si `PAYMENT_MODE=simulation` ou `PAYTECH_MOCK=true` (ancienne config), les paiements « marchent » vers `/simulation/paiement` mais **aucun prestataire n’est appelé**.

Sandbox PayDunya (tests uniquement) : `PAYMENT_PROVIDER=paydunya` + clés PayDunya + `PAYMENT_MODE=production`.

## WhatsApp en production

| Key | Value |
|-----|-------|
| `WHATSAPP_MOCK` | `false` |
| `OPENWA_API_KEY` | clé OpenWA (secret) |
| `OPENWA_BASE_URL` | `https://mywa.tickets-place.net` |
| `OPENWA_SHARED_SESSION_ID` | UUID session OpenWA déjà connectée |
| `APP_DOMAIN` | `https://<ton-service>.onrender.com` |

Vérif : `GET /api/whatsapp/status` → `config.readyForProd: true`.

## Option B — Nouveau Blueprint (1 minute)

1. Push à jour (branche `MOHAMED_COULIBALY`)
2. **New** → **Blueprint** → repo `TerraiSn1` → branche `MOHAMED_COULIBALY`
3. **Apply** (`render.yaml` configure build/start)
4. Dans le dashboard, renseigner les secrets OpenWA + PayTech (`sync: false`)

## URLs

| Surface | Chemin |
|---------|--------|
| App | `/` |
| Login joueur | `/login` |
| Backoffice | `/backoffice/login` |
| Admin | `/admin` |
| Health | `/health` |
| WhatsApp status | `/api/whatsapp/status` |
| WhatsApp QR | `/whatsapp-qr` |
| IPN PayTech | `/webhook/paytech` |

## Comptes démo (mdp `password123`)

| Rôle | Email |
|------|-------|
| Joueur | `abdou@email.com` |
| Propriétaire | `diop@terrainsn.sn` |
| Gérant | `sarr@terrainsn.sn` |
| Super admin | `admin@terrainsn.sn` |
| Mohamed joueur | `mohamed.joueur@gmail.com` |
| Mohamed gérant | `mohamed.gerant@gmail.com` |
| Mohamed proprio | `mohamed.proprietaire@gmail.com` |
| Mohamed admin | `mohamed.admin@gmail.com` |

## Limites du plan gratuit

- **Pas de disque persistant** : la DB SQLite peut être effacée à chaque redeploy / cold start machine → le seed se recharge si la base est vide.
- Cold start ~30–60 s après inactivité.
- Pour une DB durable : plan **Starter** + Docker (`Dockerfile`) + disque `/data`.
- WhatsApp : préférer `OPENWA_SHARED_SESSION_ID`.

## Re-seed forcé

Env `FORCE_SEED=true` → redeploy une fois → remettre `false`.
