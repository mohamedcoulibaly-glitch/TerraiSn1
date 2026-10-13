# Déploiement TerrainSN — deux PWA + API

## DNS (cible)

| Host | Rôle |
|------|------|
| `api.terrainsn.com` | Backend Node |
| `app.terrainsn.com` | `frontend-joueur/dist` |
| `pro.terrainsn.com` | `frontend-pro/dist` |

Config Nginx de référence : [`nginx-terrainsn.conf`](./nginx-terrainsn.conf).

## Variables backend

```
CORS_ORIGINS=https://app.terrainsn.com,https://pro.terrainsn.com
APP_DOMAIN_JOUEUR=https://app.terrainsn.com
APP_DOMAIN_PRO=https://pro.terrainsn.com
# APP_DOMAIN reste utilisé comme fallback / IPN si besoin
```

## Build domaines séparés

```bash
npm run build:joueur   # VITE_BASE=/
npm run build:pro      # VITE_BASE=/ (défaut)
```

Publier chaque `dist/` sur son host (Vercel / Netlify / Nginx).

## Render mono-host (transitoire)

`npm run build:render` produit :

- `/` → joueur
- `/pro/` → pro (`VITE_BASE=/pro/`)
- `/admin/` → admin-frontend legacy

Pour ce mode, définir aussi :

```
APP_DOMAIN_JOUEUR=https://<service>.onrender.com
APP_DOMAIN_PRO=https://<service>.onrender.com/pro
```

## Auth

| App | Route login UI | Route API |
|-----|----------------|-----------|
| Joueur | `/login` | `POST /api/auth/login` (joueurs uniquement) |
| Pro | `/login` | `POST /api/backoffice/auth/login` (pro uniquement) |

## PWA

Chaque origine a son propre `manifest` (`id` distinct) et service worker Workbox → **aucune collision** cache / push.
