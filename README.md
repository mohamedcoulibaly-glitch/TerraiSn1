# TerrainSN

App de réservation de terrains (Sénégal) — React + Express + PWA.

## Lancer en local

```bash
# Terminal 1 — API (migrations + seed si base vide)
cd backend
cp .env.example .env   # si besoin
npm install
npm run setup          # migrate + données de démo
npm run dev            # → http://localhost:3001

# Terminal 2 — Frontend
cd frontend
npm install
npm run dev            # → http://localhost:8080
```

Comptes démo (mot de passe `password123`) : `abdou@email.com` (joueur), `diop@terrainsn.sn` (propriétaire), `sarr@terrainsn.sn` (gérant), `admin@terrainsn.sn` (admin).

## Paiements

- **Tests / sandbox** : PayDunya (`PAYMENT_GATEWAY=paydunya`, clés `PAYDUNYA_*` en mode test).
- **Production** : PayTech (`PAYMENT_GATEWAY=paytech`, `PAYTECH_ENV=prod`).
- Les webhooks ont besoin d’une URL HTTPS publique : `ngrok http 3001` (callback `/webhook/paydunya` en sandbox).

## PWA (build + check)

```bash
cd frontend
npm run build          # génère dist/ + Service Worker
npm run audit:pwa      # vérifie manifest + icônes + SW
npm run lhci           # audit PWA + Lighthouse CI
npm run preview        # tester le build localement
```

## Web Push (rappels)

1. `cd backend && node scripts/generate-vapid-keys.js`
2. Copier les 3 variables `VAPID_*` dans `backend/.env`
3. Redémarrer le backend
4. Joueur connecté → **Profil → Notifications → Activer**

## CI/CD (GitHub Actions)

Chaque push / PR lance **CI/CD** (`.github/workflows/ci.yml`) :

| Job | Ce qui est vérifié |
|-----|-------------------|
| Backend | `npm test` + smoke `GET /health` |
| Frontend | lint, Vitest, build, audit PWA |
| Admin | `tsc` + build Vite |
| Lighthouse | perf / a11y (n’échoue pas le pipeline s’il flotte) |
| Docker | image API + smoke du conteneur |

Sur **`main` / `master`** uniquement :

- l’image API est poussée sur `ghcr.io/<org>/terrainsn-api`
- le frontend est déployé sur Vercel **si** les secrets sont présents

Secrets optionnels (Settings → Secrets and variables → Actions) :

- `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` — déploiement frontend
- `LHCI_GITHUB_APP_TOKEN` — commentaires Lighthouse sur les PR
- variable `VITE_API_URL` — URL de l’API embarquée dans le build (sinon `https://api.terrainsn.com/api`)

Pour rendre la CI obligatoire : Settings → Branches → Branch protection → Require status checks → `Backend — tests + API`, `Frontend — lint, tests, build, PWA`, `Admin — typecheck + build`.

```bash
docker compose up --build   # API locale prod-like → http://localhost:3001/health
```

## Structure

| Dossier | Rôle |
|--------|------|
| `frontend/` | App joueur + backoffice (Vite/React) |
| `backend/` | API Express + SQLite |

## Rôles

- **Joueur** : réserver, payer, voir ses matchs (hors-ligne possible)
- **Gérant** : créneaux + réservations du terrain
- **Propriétaire** : terrains + revenus
- **Super admin** : toute la plateforme
