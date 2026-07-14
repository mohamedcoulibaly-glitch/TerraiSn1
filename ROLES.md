# Rôles TerrainSN

## super_admin

- Accès exclusif à `admin-frontend`.
- Crée les terrains, propriétaires et gérants.
- Active ou suspend les terrains.
- Consulte les revenus globaux.
- Ne crée aucune réservation et ne gère aucun créneau.

## proprietaire

- Consulte ses terrains, réservations et revenus uniquement.
- Un propriétaire peut être lié à plusieurs terrains via `terrains.proprietaire_id`.

## gerant

- Est affecté à un terrain.
- Gère les horaires, créneaux et réservations de ce terrain uniquement.
- Enregistre les matchs joués et les soldes encaissés.

## joueur

- Consulte les terrains et créneaux publics.
- Crée et gère uniquement ses propres réservations.

## Création du super administrateur

```powershell
cd backend
node scripts/createSuperAdmin.js "+221700000000" "MotDePasseSolide" "Administrateur"
```

Le script refuse la création si un compte `super_admin` existe déjà.
