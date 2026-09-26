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

Puis **Environment** → ajoute au minimum :

| Key | Value |
|-----|-------|
| `NODE_ENV` | `production` |
| `JWT_SECRET` | une longue chaîne aléatoire |
| `JWT_REFRESH_SECRET` | une autre chaîne aléatoire |
| `PAYTECH_MOCK` | `true` |
| `PAYMENT_MODE` | `simulation` |
| `SKIP_SEED` | `false` |
| `COOKIE_SAMESITE` | `lax` |

**Manual Deploy** → **Deploy latest commit**.

> Ne laisse pas Build = `yarn` et Start = `yarn start`.

## WhatsApp en production (obligatoire)

Sans ces variables, **aucun message réel** ne part (mock ou OpenWA non configuré).

| Key | Value |
|-----|-------|
| `WHATSAPP_MOCK` | `false` |
| `OPENWA_API_KEY` | clé OpenWA (secret) |
| `OPENWA_BASE_URL` | `https://mywa.tickets-place.net` |
| `OPENWA_SHARED_SESSION_ID` | UUID d’une session OpenWA **déjà connectée** (recommandé sur Render free) |
| `APP_DOMAIN` | `https://<ton-service>.onrender.com` |

Vérifications après deploy :

1. `GET /api/whatsapp/status` → `connected: true`, `mock: false`
2. Ouvre `/whatsapp-qr` si `OPENWA_SHARED_SESSION_ID` n’est pas défini (scanner le QR)
3. Créer une réservation gérant en mode paiement → le joueur doit recevoir le lien WhatsApp

> Si `WHATSAPP_MOCK=true` (ancienne config), les logs affichent `[WHATSAPP MOCK]` et **rien n’est envoyé**.

## Option B — Nouveau Blueprint (1 minute)

1. Push à jour (déjà sur `MOHAMED_COULIBALY`)
2. **New** → **Blueprint** → repo `TerraiSn1` → branche `MOHAMED_COULIBALY`
3. **Apply** (`render.yaml` configure build/start + env)
4. Dans le dashboard, renseigner les secrets OpenWA (`sync: false` dans le blueprint)

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
- WhatsApp : préférer `OPENWA_SHARED_SESSION_ID` (session déjà authentifiée côté OpenWA) plutôt que de rescanner un QR à chaque machine neuve.

## Re-seed forcé

Env `FORCE_SEED=true` → redeploy une fois → remettre `false`.
