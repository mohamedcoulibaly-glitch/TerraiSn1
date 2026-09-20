# Rapport de validation tests TerrainSN
# Généré pour onboarding QA / CI

## Commandes

```bash
# Depuis teranga-pitch-app-main/teranga-pitch-app-main

# 1) Unitaires + parcours + intégration + suites CDC existantes
npm test

# 2) Uniquement nouveaux unitaires métier
npm run test:unit --prefix backend

# 3) Parcours A→Z (simulation métier)
npm run test:parcours --prefix backend

# 4) Intégration HTTP
npm run test:integration --prefix backend

# 5) Frontend Vitest
npm test --prefix frontend

# 6) E2E Playwright (démarre Vite automatiquement)
npm install
npx playwright install chromium
npm run test:e2e
```

## Couverture ajoutée

| Niveau | Fichiers |
|--------|----------|
| Unit schedule | `backend/scripts/test-schedule.js` |
| Unit pricing | `backend/scripts/test-pricing.js` |
| Unit OTP/JWT | `backend/scripts/test-otp-auth.js` |
| Unit lock créneaux | `backend/scripts/test-reservation-lock.js` |
| Parcours A→Z | `backend/scripts/test-parcours-complet.js` |
| Intégration API | `backend/scripts/test-integration-api-parcours.js` |
| Front roles/schedule/parcours | `frontend/src/**/*.test.ts` |
| E2E UI | `e2e/parcours-critiques.spec.ts` |
