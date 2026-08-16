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
