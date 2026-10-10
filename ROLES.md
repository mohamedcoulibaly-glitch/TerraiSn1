# Rôles TerrainSN

## super_admin

- Accès exclusif à `admin-frontend`.
- Crée les terrains, propriétaires et gérants.
- Active ou suspend les terrains.
- Consulte les revenus globaux.
- **Valide / envoie / rejette les retraits gérants** (caisse plateforme) — pas le propriétaire.
- Ne crée aucune réservation et ne gère aucun créneau.

## proprietaire

- Consulte ses terrains, réservations et revenus uniquement.
- Un propriétaire peut être lié à plusieurs terrains via `terrains.proprietaire_id`.
- Peut **voir** les demandes de retrait liées à ses terrains (`GET /api/proprietaire/retraits`) en lecture seule.
- N’approuve pas les virements : la validation reste côté plateforme (super_admin).

## gerant

- Est affecté à un terrain.
- Gère les horaires, créneaux et réservations de ce terrain uniquement.
- Enregistre les matchs joués et les soldes encaissés.
- Peut **demander** un retrait du portefeuille ; l’exécution est validée par le super_admin.

## joueur

- Consulte les terrains et créneaux publics.
- Crée et gère uniquement ses propres réservations.
- Peut **supprimer / anonymiser** son compte (`POST /api/auth/delete-account`) : PII effacée, historique financier terrains conservé.

## Création du super administrateur

```powershell
cd backend
node scripts/createSuperAdmin.js "+221700000000" "MotDePasseSolide" "Administrateur"
```

Le script refuse la création si un compte `super_admin` existe déjà.
