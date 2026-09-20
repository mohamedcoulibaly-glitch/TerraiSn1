# Déploiement Render — TerrainSN (1 minute)

Tout est préparé : **un seul service** (API + frontend + admin + seed démo) via Blueprint.

## Déployer en ~1 minute

1. Pousse ce repo sur GitHub (branche à jour).
2. Va sur [https://dashboard.render.com](https://dashboard.render.com) → **New** → **Blueprint**.
3. Connecte le repo `TerraiSn1` (ou ton fork) et sélectionne la branche.
4. Render détecte `render.yaml` → clique **Apply**.
5. Attends le build Docker (~3–8 min la 1ʳᵉ fois) → ouvre l’URL `https://terrainsn-xxxx.onrender.com`.

C’est tout. Au premier démarrage, la base SQLite est créée sur le **disque persistant** `/data` et le **seed démo** charge tous les comptes / terrains.

> Plan **Starter** requis (disque persistant). Une seule instance (SQLite).

## URLs après déploiement

| Surface | Chemin |
|---------|--------|
| App joueur + backoffice | `https://<ton-service>.onrender.com/` |
| Login joueur | `/login` |
| Backoffice (gérant / proprio) | `/backoffice/login` |
| Admin super-admin | `/admin` |
| Healthcheck | `/health` |
| API | `/api/...` |

## Comptes démo (seed automatique)

Mot de passe commun : **`password123`**

| Rôle | Email | Téléphone |
|------|-------|-----------|
| Joueur | `abdou@email.com` | `77 123 45 67` |
| Propriétaire | `diop@terrainsn.sn` | `78 100 00 01` |
| Gérant | `sarr@terrainsn.sn` | `77 111 22 33` |
| Super admin | `admin@terrainsn.sn` | `70 000 00 00` |

### Comptes Mohamed (connexion **par email** uniquement)

Même WhatsApp `+221 77 826 12 25` — ne pas se connecter au téléphone partagé.

| Rôle | Email |
|------|--------|
| Joueur | `mohamed.joueur@gmail.com` |
| Gérant | `mohamed.gerant@gmail.com` |
| Propriétaire | `mohamed.proprietaire@gmail.com` |
| Super admin | `mohamed.admin@gmail.com` |

## Variables d’environnement (déjà dans `render.yaml`)

| Variable | Valeur par défaut | Rôle |
|----------|-------------------|------|
| `JWT_SECRET` / `JWT_REFRESH_SECRET` | générés auto | Auth |
| `DB_PATH` | `/data/terrainsn.db` | SQLite persistant |
| `UPLOAD_ROOT` | `/data/uploads` | Photos / QR |
| `SKIP_SEED` | `false` | Seed si base vide |
| `FORCE_SEED` | `false` | Remettre `true` **une fois** pour recharger le seed, puis `false` |
| `WHATSAPP_MOCK` | `true` | Pas besoin d’OpenWA |
| `PAYTECH_MOCK` / `PAYMENT_MODE` | mock / simulation | Paiements démo |
| `APP_DOMAIN` | auto via `RENDER_EXTERNAL_URL` | Liens / CORS |

Pour activer WhatsApp / PayTech / PayDunya réels : renseigner les clés dans le dashboard Render (voir `backend/.env.example`) et désactiver les mocks.

## Re-seed en prod (optionnel)

1. Dashboard → Service → Environment → `FORCE_SEED=true`
2. **Manual Deploy** → Wait for deploy
3. Repasser `FORCE_SEED=false` (sinon le seed écrase la DB à chaque restart)

## Test local de l’image Docker

```bash
docker build -t terrainsn .
docker run --rm -p 3001:3001 \
  -e JWT_SECRET=dev-secret-change-me \
  -e JWT_REFRESH_SECRET=dev-refresh-change-me \
  -v terrainsn-data:/data \
  terrainsn
```

Puis ouvrir http://localhost:3001 — les comptes démo ci-dessus fonctionnent.

## Dépannage

| Symptôme | Action |
|----------|--------|
| Build échoue | Vérifier Root Directory = racine du monorepo (là où est `render.yaml`) |
| Données perdues après redeploy | Vérifier le disque monté sur `/data` |
| Page blanche | Attendre la fin du build ; hard refresh ; `/health` doit répondre JSON |
| Login KO | Vérifier seed (logs : « Base vide — chargement » ou `FORCE_SEED`) |
| Cookie refresh | `COOKIE_SAMESITE=lax` (déjà configuré) |

## Architecture

```
Navigateur → Render Web Service (Docker)
               ├── /api, /webhook, /uploads  → Express
               ├── /admin                    → admin-frontend
               └── /*                        → frontend (joueur + backoffice)
Disque /data → terrainsn.db + uploads
```
