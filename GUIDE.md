# Guide TerrainSN

App réservation de terrains — React (Vite) + Express + SQLite + PWA. **Prérequis :** Node.js 18+.

## Lancer

```bash
# Terminal 1 — API → http://localhost:3001
cd backend && cp .env.example .env && npm install && npm run seed && npm run dev

# Terminal 2 — Front → http://localhost:8080
cd frontend
# .env : VITE_API_URL=http://localhost:3001/api
npm install && npm run dev
```

## URLs

- Joueur : http://localhost:8080 — login `/login`
- Backoffice : `/backoffice/login`
- API : http://localhost:3001

## Accès démo (après `npm run seed`)

Mot de passe : **`password123`**

| Rôle | Identifiant (téléphone **ou** email) |
|------|--------------------------------------|
| Joueur | `77 123 45 67` / `abdou@email.com` |
| Propriétaire | `78 100 00 01` / `diop@terrainsn.sn` |
| Gérant | `77 111 22 33` / `sarr@terrainsn.sn` |
| Super admin | `70 000 00 00` / `admin@terrainsn.sn` |

### Comptes Mohamed (même WhatsApp `+221 77 826 12 25`)

**Toujours se connecter par email** (le numéro est partagé entre tous les rôles).

| Rôle | Email |
|------|--------|
| Joueur | `mohamed.joueur@gmail.com` |
| Gérant | `mohamed.gerant@gmail.com` |
| Propriétaire | `mohamed.proprietaire@gmail.com` |
| Super admin | `mohamed.admin@gmail.com` |

```powershell
cd backend
npm run seed            # seed officiel (inclut Mohamed)
npm run seed:mohamed    # idem + récap
npm run seed:mohamed -- --send-wa   # + envoi WhatsApp réels sur +221778261225

# Sur PowerShell, ne pas utiliser && — en une ligne :
cd backend; npm run seed:mohamed -- --send-wa
```

- Espace joueur : http://localhost:8080/login
- Backoffice : http://localhost:8080/backoffice/login

```bash
cd backend
node scripts/createSuperAdmin.js "+221700000000" "MotDePasseSolide" "Administrateur"
```

## WhatsApp (réel)

1. Dans `backend/.env` : `WHATSAPP_MOCK=false`
2. Lancer l’API : `npm run dev`
3. Si un QR est demandé : ouvrir http://localhost:3001/whatsapp-qr et scanner
4. Test rapide : `POST http://localhost:3001/api/whatsapp/test` avec `{ "telephone": "+221778261225" }`
   ou `npm run whatsapp:test -- +221778261225`
5. Burst multi-rôles : `npm run seed:mohamed -- --send-wa`

## Commandes

| Où | Commande | Effet |
|----|----------|-------|
| backend | `npm run dev` / `start` | API (dev/prod) |
| backend | `npm run seed` / `migrate` | Données / migrations |
| frontend | `npm run dev` / `build` / `preview` | Dev / build / preview |
| frontend | `npm run audit:pwa` / `lhci` | Checks PWA |

## Web Push

1. `cd backend && node scripts/generate-vapid-keys.js`
2. Coller `VAPID_*` dans `.env`, redémarrer l’API
3. Joueur → Profil → Notifications → Activer

## Astuces

- Paiement local : `PAYMENT_MODE=simulation` + `PAYTECH_MOCK=true`
- SQLite auto (`backend/*.db` hors Git)
- Branche : `MOHAMED_COULIBALY` — sync `git pull origin main`
- Rôles : voir `ROLES.md`
