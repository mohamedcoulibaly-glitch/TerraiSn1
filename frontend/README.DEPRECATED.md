# `frontend/` — déprécié

Ce dossier est l’**ancien monolithe** (joueur + backoffice dans une seule SPA).

## Remplacement

| Ancien | Nouveau | Domaine |
|--------|---------|---------|
| Routes joueur | `frontend-joueur/` | app.terrainsn.com (dev `:5173`) |
| Routes backoffice | `frontend-pro/` | pro.terrainsn.com (dev `:5174`) |
| Utils partagés | `shared/` | — |

Le dossier est conservé temporairement pour référence / rollback.
Ne plus y développer de features. Les scripts racine (`npm run dev`, `build:render`) pointent vers les nouveaux packages.

## Suppression

Après validation métier complète, supprimer `frontend/` et mettre à jour Playwright / Docker si des chemins y font encore référence.
