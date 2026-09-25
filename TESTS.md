# Rapport de validation tests TerrainSN

## Commandes

```bash
# Depuis teranga-pitch-app-main/

# 1) Unitaires + parcours + intégration (backend + frontend)
npm test

# 2) Unitaires métier backend
npm run test:unit --prefix backend

# 3) Parcours A→Z tous rôles
npm run test:parcours --prefix backend
npm run test:parcours-roles --prefix backend

# 4) Intégration HTTP tous rôles
npm run test:integration --prefix backend
npm run test:integration-roles --prefix backend

# 5) Frontend Vitest (rôles, routes, navigation, parcours)
npm test --prefix frontend

# 6) E2E Playwright (API mockée)
npm install
npx playwright install chromium
npm run test:e2e
```

## Couverture

| Niveau | Fichiers | Contenu |
|--------|----------|---------|
| Unit schedule / pricing / OTP / lock | `backend/scripts/test-*.js` | Créneaux, devis, JWT, double booking |
| Unit kanban / check-in | `test-kanban-rules.js`, `test-checkin-rules.js` | Stages opérationnels |
| Parcours A→Z | `test-parcours-complet.js`, **`test-parcours-tous-roles.js`** | Joueur, gérant, proprio, SA + cross-rôle |
| Intégration API | `test-integration-api-parcours.js`, **`test-integration-api-tous-roles.js`** | HTTP + authz 401/403 |
| Front roles / routes | `frontend/src/auth/roles.test.ts`, **`router/routesParRole.test.ts`** | Homes, profils, ROUTE_MAP |
| Front parcours / nav | **`parcoursTousRoles.test.ts`**, **`navigationGuards.test.ts`** | Parcours métier + garde-fous |
| E2E UI | `e2e/parcours-critiques.spec.ts`, **`e2e/parcours-tous-roles.spec.ts`** | Boutons / onglets / « Voir l'app » |

## Correctifs navigation validés par les tests

- Lien SA **Voir l'app** → `/` (plus `/joueur`)
- Routes SA `gerants` / `proprietaires` / `superadmins` montées
- Menu propriétaire **Terrains** → `/backoffice/proprietaire/terrains`
- Liens profil joueur → notifications / sécurité / aide
- API `GET /api/gerant/terrains` + `POST /api/gerant/heartbeat` (layout gérant)
