---

> ---
>
> > ---
> >
> > > ---
> > >
> > >
> > >
> > > > ---
> > > >
> > > > > **Rôle** Tu es un développeur fullstack senior expert React.js, TypeScript, Node.js et SQLite. Tu implémentes un système de notifications push PWA complet pour les 4 acteurs de TerrainSN. Le système utilise la Web Push API avec les service workers déjà en place. Aucune modification de logique de paiement. Montre chaque fichier complet et attends ma validation avant de continuer.
> > > > >
> > > > > ---
> > > > >
> > > > > **Règle absolue** Ne toucher à aucune logique de paiement (Mohamed). Ne pas casser le service worker existant — l'étendre uniquement. 
> > > > >
> > > > > ---
> > > > >
> > > > > **PHASE 1 — Audit**
> > > > >
> > > > > Scanne et identifie :
> > > > >
> > > > > - Le service worker existant `sw.js` : ce qui est déjà dedans
> > > > > - Si `manifest.json` a les champs PWA corrects pour les notifications
> > > > > - Si une table `push_subscriptions` ou équivalent existe en DB
> > > > > - Si `web-push` est déjà installé dans `package.json`
> > > > > - Les endroits dans le code où les notifications WhatsApp sont déclenchées (ce sont les mêmes points où les push doivent être déclenchés)
> > > > >
> > > > > Produis le rapport et attends ma validation.
> > > > >
> > > > > ---
> > > > >
> > > > > **PHASE 2 — Migration base de données**
> > > > >
> > > > > ```sql
> > > > > -- Abonnements push par utilisateur et appareil
> > > > > CREATE TABLE IF NOT EXISTS push_subscriptions (
> > > > >   id INTEGER PRIMARY KEY AUTOINCREMENT,
> > > > >   user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
> > > > >   endpoint TEXT NOT NULL,
> > > > >   p256dh TEXT NOT NULL,
> > > > >   auth TEXT NOT NULL,
> > > > >   user_agent TEXT,
> > > > >   actif INTEGER DEFAULT 1,
> > > > >   created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
> > > > >   last_used_at DATETIME,
> > > > >   UNIQUE(user_id, endpoint)
> > > > > );
> > > > >
> > > > > -- Log des notifications push envoyées
> > > > > CREATE TABLE IF NOT EXISTS push_logs (
> > > > >   id INTEGER PRIMARY KEY AUTOINCREMENT,
> > > > >   user_id INTEGER REFERENCES users(id),
> > > > >   type_notif TEXT NOT NULL,
> > > > >   titre TEXT NOT NULL,
> > > > >   corps TEXT NOT NULL,
> > > > >   data TEXT,
> > > > >   -- JSON avec des données pour la navigation au clic
> > > > >   statut TEXT DEFAULT 'envoye'
> > > > >     CHECK(statut IN ('envoye','echoue','clique','ferme')),
> > > > >   erreur TEXT,
> > > > >   -- message d'erreur si statut = echoue
> > > > >   created_at DATETIME DEFAULT CURRENT_TIMESTAMP
> > > > > );
> > > > >
> > > > > -- Préférences notifications par utilisateur
> > > > > CREATE TABLE IF NOT EXISTS notif_preferences (
> > > > >   id INTEGER PRIMARY KEY AUTOINCREMENT,
> > > > >   user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
> > > > >   -- Joueur
> > > > >   push_resa_confirmee INTEGER DEFAULT 1,
> > > > >   push_resa_annulee INTEGER DEFAULT 1,
> > > > >   push_rappel_match INTEGER DEFAULT 1,
> > > > >   push_remboursement INTEGER DEFAULT 1,
> > > > >   -- Gérant
> > > > >   push_nouvelle_resa INTEGER DEFAULT 1,
> > > > >   push_match_imminent INTEGER DEFAULT 1,
> > > > >   push_reversement INTEGER DEFAULT 1,
> > > > >   push_dette_rappel INTEGER DEFAULT 1,
> > > > >   -- Propriétaire
> > > > >   push_revenus INTEGER DEFAULT 1,
> > > > >   push_sante_gerant INTEGER DEFAULT 1,
> > > > >   push_abonnement INTEGER DEFAULT 1,
> > > > >   -- Super admin
> > > > >   push_retrait_demande INTEGER DEFAULT 1,
> > > > >   push_payout_echec INTEGER DEFAULT 1,
> > > > >   push_alertes_terrain INTEGER DEFAULT 1,
> > > > >   updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
> > > > >   UNIQUE(user_id)
> > > > > );
> > > > >
> > > > > CREATE INDEX IF NOT EXISTS idx_push_sub_user
> > > > >   ON push_subscriptions(user_id, actif);
> > > > > CREATE INDEX IF NOT EXISTS idx_push_logs_user
> > > > >   ON push_logs(user_id, created_at);
> > > > >
> > > > > ```
> > > > >
> > > > > ---
> > > > >
> > > > > **PHASE 3 — Backend : service push**
> > > > >
> > > > > ```bash
> > > > > npm install web-push
> > > > >
> > > > > ```
> > > > >
> > > > > Générer les clés VAPID une seule fois et les stocker dans `.env` :
> > > > >
> > > > > ```bash
> > > > > node -e "const wp = require('web-push'); console.log(wp.generateVAPIDKeys())"
> > > > >
> > > > > ```
> > > > >
> > > > > Ajouter dans `.env` :
> > > > >
> > > > > ```
> > > > > VAPID_PUBLIC_KEY=
> > > > > VAPID_PRIVATE_KEY=
> > > > > VAPID_EMAIL=mailto:admin@terrainsn.com
> > > > >
> > > > > ```
> > > > >
> > > > > Créer `services/pushService.js` :
> > > > >
> > > > > ```js
> > > > > const webpush = require('web-push');
> > > > >
> > > > > webpush.setVapidDetails(
> > > > >   process.env.VAPID_EMAIL,
> > > > >   process.env.VAPID_PUBLIC_KEY,
> > > > >   process.env.VAPID_PRIVATE_KEY
> > > > > );
> > > > >
> > > > > // ─── Types de notifications avec leur config ───
> > > > > const NOTIF_CONFIG = {
> > > > >
> > > > >   // ── JOUEUR ──
> > > > >   RESA_CONFIRMEE: {
> > > > >     titre: '✅ Réservation confirmée !',
> > > > >     icone: '/icons/icon-192.png',
> > > > >     badge: '/icons/badge-72.png',
> > > > >     vibration: [200, 100, 200],
> > > > >     preference: 'push_resa_confirmee',
> > > > >     priorite: 'high'
> > > > >   },
> > > > >   RESA_CONFIRMEE_SANS_AVANCE: {
> > > > >     titre: '✅ Réservation confirmée !',
> > > > >     icone: '/icons/icon-192.png',
> > > > >     badge: '/icons/badge-72.png',
> > > > >     vibration: [200, 100, 200],
> > > > >     preference: 'push_resa_confirmee',
> > > > >     priorite: 'high'
> > > > >   },
> > > > >
> > > > >   REMBOURSEMENT: {
> > > > >     titre: '💰 Remboursement en cours',
> > > > >     icone: '/icons/icon-192.png',
> > > > >     badge: '/icons/badge-72.png',
> > > > >     vibration: [100],
> > > > >     preference: 'push_remboursement',
> > > > >     priorite: 'normal'
> > > > >   },
> > > > >   RAPPEL_MATCH_J1: {
> > > > >     titre: '⚽ Ton match est demain !',
> > > > >     icone: '/icons/icon-192.png',
> > > > >     badge: '/icons/badge-72.png',
> > > > >     vibration: [100, 50, 100],
> > > > >     preference: 'push_rappel_match',
> > > > >     priorite: 'normal'
> > > > >   },
> > > > >   RAPPEL_MATCH_H2: {
> > > > >     titre: '⚽ Ton match dans 2 heures !',
> > > > >     icone: '/icons/icon-192.png',
> > > > >     badge: '/icons/badge-72.png',
> > > > >     vibration: [200, 100, 200, 100, 200],
> > > > >     preference: 'push_rappel_match',
> > > > >     priorite: 'high'
> > > > >   },
> > > > >   RESA_ANNULEE_GERANT: {
> > > > >     titre: '❌ Réservation annulée',
> > > > >     icone: '/icons/icon-192.png',
> > > > >     badge: '/icons/badge-72.png',
> > > > >     vibration: [300],
> > > > >     preference: 'push_resa_annulee',
> > > > >     priorite: 'high'
> > > > >   },
> > > > >
> > > > >   // ── GÉRANT ──
> > > > >   NOUVELLE_RESA: {
> > > > >     titre: '🔔 Nouvelle réservation !',
> > > > >     icone: '/icons/icon-192.png',
> > > > >     badge: '/icons/badge-72.png',
> > > > >     vibration: [200, 100, 200],
> > > > >     preference: 'push_nouvelle_resa',
> > > > >     priorite: 'high'
> > > > >   },
> > > > >   RESA_EN_ATTENTE: {
> > > > >     titre: '⏳ Lien de paiement envoyé',
> > > > >     icone: '/icons/icon-192.png',
> > > > >     badge: '/icons/badge-72.png',
> > > > >     vibration: [100],
> > > > >     preference: 'push_nouvelle_resa',
> > > > >     priorite: 'normal'
> > > > >   },
> > > > >   RESA_ANNULEE_JOUEUR: {
> > > > >     titre: '❌ Réservation annulée par le joueur',
> > > > >     icone: '/icons/icon-192.png',
> > > > >     badge: '/icons/badge-72.png',
> > > > >     vibration: [200],
> > > > >     preference: 'push_nouvelle_resa',
> > > > >     priorite: 'normal'
> > > > >   },
> > > > >   MATCH_IMMINENT: {
> > > > >     titre: '⚡ Match dans 30 min — prêt à scanner ?',
> > > > >     icone: '/icons/icon-192.png',
> > > > >     badge: '/icons/badge-72.png',
> > > > >     vibration: [200, 100, 200, 100, 200],
> > > > >     preference: 'push_match_imminent',
> > > > >     priorite: 'high'
> > > > >   },
> > > > >   REVERSEMENT_CREDITE: {
> > > > >     titre: '💰 Virement reçu !',
> > > > >     icone: '/icons/icon-192.png',
> > > > >     badge: '/icons/badge-72.png',
> > > > >     vibration: [200, 100, 200],
> > > > >     preference: 'push_reversement',
> > > > >     priorite: 'normal'
> > > > >   },
> > > > >   DETTE_RAPPEL_J7: {
> > > > >     titre: '📋 Commission due — 7 jours restants',
> > > > >     icone: '/icons/icon-192.png',
> > > > >     badge: '/icons/badge-72.png',
> > > > >     vibration: [100],
> > > > >     preference: 'push_dette_rappel',
> > > > >     priorite: 'normal'
> > > > >   },
> > > > >   DETTE_RAPPEL_J3: {
> > > > >     titre: '⚠️ Commission due — 3 jours restants',
> > > > >     icone: '/icons/icon-192.png',
> > > > >     badge: '/icons/badge-72.png',
> > > > >     vibration: [200, 100, 200],
> > > > >     preference: 'push_dette_rappel',
> > > > >     priorite: 'high'
> > > > >   },
> > > > >   DETTE_RAPPEL_J1: {
> > > > >     titre: '🚨 Commission due — demain dernier délai',
> > > > >     icone: '/icons/icon-192.png',
> > > > >     badge: '/icons/badge-72.png',
> > > > >     vibration: [300, 100, 300, 100, 300],
> > > > >     preference: 'push_dette_rappel',
> > > > >     priorite: 'high'
> > > > >   },
> > > > >   DETTE_RETARD: {
> > > > >     titre: '🚨 Commission en retard',
> > > > >     icone: '/icons/icon-192.png',
> > > > >     badge: '/icons/badge-72.png',
> > > > >     vibration: [500, 100, 500],
> > > > >     preference: 'push_dette_rappel',
> > > > >     priorite: 'high'
> > > > >   },
> > > > >
> > > > >   // ── PROPRIÉTAIRE ──
> > > > >   MATCH_CONFIRME_TERRAIN: {
> > > > >     titre: '✅ Nouveau match confirmé',
> > > > >     icone: '/icons/icon-192.png',
> > > > >     badge: '/icons/badge-72.png',
> > > > >     vibration: [100],
> > > > >     preference: 'push_revenus',
> > > > >     priorite: 'normal'
> > > > >   },
> > > > >   SANTE_ORANGE: {
> > > > >     titre: '🟡 Score gérant en baisse',
> > > > >     icone: '/icons/icon-192.png',
> > > > >     badge: '/icons/badge-72.png',
> > > > >     vibration: [100, 50, 100],
> > > > >     preference: 'push_sante_gerant',
> > > > >     priorite: 'normal'
> > > > >   },
> > > > >   SANTE_ROUGE: {
> > > > >     titre: '🔴 Score gérant critique',
> > > > >     icone: '/icons/icon-192.png',
> > > > >     badge: '/icons/badge-72.png',
> > > > >     vibration: [300, 100, 300],
> > > > >     preference: 'push_sante_gerant',
> > > > >     priorite: 'high'
> > > > >   },
> > > > >   ABONNEMENT_J7: {
> > > > >     titre: '📅 Abonnement — 7 jours avant échéance',
> > > > >     icone: '/icons/icon-192.png',
> > > > >     badge: '/icons/badge-72.png',
> > > > >     vibration: [100],
> > > > >     preference: 'push_abonnement',
> > > > >     priorite: 'normal'
> > > > >   },
> > > > >   ABONNEMENT_RETARD: {
> > > > >     titre: '⛔ Abonnement en retard',
> > > > >     icone: '/icons/icon-192.png',
> > > > >     badge: '/icons/badge-72.png',
> > > > >     vibration: [300, 100, 300],
> > > > >     preference: 'push_abonnement',
> > > > >     priorite: 'high'
> > > > >   },
> > > > >   TERRAIN_SUSPENDU: {
> > > > >     titre: '⛔ Terrain suspendu',
> > > > >     icone: '/icons/icon-192.png',
> > > > >     badge: '/icons/badge-72.png',
> > > > >     vibration: [500],
> > > > >     preference: 'push_alertes_terrain',
> > > > >     priorite: 'high'
> > > > >   },
> > > > >   TERRAIN_REACTIVE: {
> > > > >     titre: '✅ Terrain réactivé',
> > > > >     icone: '/icons/icon-192.png',
> > > > >     badge: '/icons/badge-72.png',
> > > > >     vibration: [200, 100, 200],
> > > > >     preference: 'push_alertes_terrain',
> > > > >     priorite: 'normal'
> > > > >   },
> > > > >   REVENUS_FIN_MOIS: {
> > > > >     titre: '📊 Résumé de vos revenus du mois',
> > > > >     icone: '/icons/icon-192.png',
> > > > >     badge: '/icons/badge-72.png',
> > > > >     vibration: [100],
> > > > >     preference: 'push_revenus',
> > > > >     priorite: 'normal'
> > > > >   },
> > > > >
> > > > >   // ── SUPER ADMIN ──
> > > > >   RETRAIT_DEMANDE: {
> > > > >     titre: '💸 Demande de retrait reçue',
> > > > >     icone: '/icons/icon-192.png',
> > > > >     badge: '/icons/badge-72.png',
> > > > >     vibration: [200, 100, 200],
> > > > >     preference: 'push_retrait_demande',
> > > > >     priorite: 'high'
> > > > >   },
> > > > >   PAYOUT_ECHEC: {
> > > > >     titre: '❌ Payout automatique en échec',
> > > > >     icone: '/icons/icon-192.png',
> > > > >     badge: '/icons/badge-72.png',
> > > > >     vibration: [500, 100, 500],
> > > > >     preference: 'push_payout_echec',
> > > > >     priorite: 'high'
> > > > >   },
> > > > >   ESSAI_EXPIRE_J7: {
> > > > >     titre: '⏳ Essai terrain — 7 jours restants',
> > > > >     icone: '/icons/icon-192.png',
> > > > >     badge: '/icons/badge-72.png',
> > > > >     vibration: [100],
> > > > >     preference: 'push_alertes_terrain',
> > > > >     priorite: 'normal'
> > > > >   },
> > > > >   ABONNEMENT_RETARD_ADMIN: {
> > > > >     titre: '🚨 Terrain — abonnement en retard',
> > > > >     icone: '/icons/icon-192.png',
> > > > >     badge: '/icons/badge-72.png',
> > > > >     vibration: [300, 100, 300],
> > > > >     preference: 'push_alertes_terrain',
> > > > >     priorite: 'high'
> > > > >   },
> > > > >   SCORE_CRITIQUE_ADMIN: {
> > > > >     titre: '🔴 Score gérant critique — 2 mois',
> > > > >     icone: '/icons/icon-192.png',
> > > > >     badge: '/icons/badge-72.png',
> > > > >     vibration: [200, 100, 200],
> > > > >     preference: 'push_alertes_terrain',
> > > > >     priorite: 'high'
> > > > >   },
> > > > >   DETTE_RETARD_ADMIN: {
> > > > >     titre: '🚨 Dette commission en retard',
> > > > >     icone: '/icons/icon-192.png',
> > > > >     badge: '/icons/badge-72.png',
> > > > >     vibration: [300],
> > > > >     preference: 'push_alertes_terrain',
> > > > >     priorite: 'high'
> > > > >   },
> > > > > };
> > > > >
> > > > > /**
> > > > >  * Fonction principale d'envoi d'une notification push
> > > > >  * à un utilisateur (tous ses appareils actifs)
> > > > >  */
> > > > > async function envoyerPush(user_id, type, payload) {
> > > > >   const config = NOTIF_CONFIG[type];
> > > > >   if (!config) {
> > > > >     console.error(`[PUSH] Type inconnu : ${type}`);
> > > > >     return;
> > > > >   }
> > > > >
> > > > >   // Vérifier la préférence utilisateur
> > > > >   const prefs = db.prepare(`
> > > > >     SELECT * FROM notif_preferences WHERE user_id = ?
> > > > >   `).get(user_id);
> > > > >
> > > > >   if (prefs && prefs[config.preference] === 0) {
> > > > >     return; // Utilisateur a désactivé ce type
> > > > >   }
> > > > >
> > > > >   // Récupérer tous les abonnements actifs de cet utilisateur
> > > > >   const abonnements = db.prepare(`
> > > > >     SELECT * FROM push_subscriptions
> > > > >     WHERE user_id = ? AND actif = 1
> > > > >   `).all(user_id);
> > > > >
> > > > >   if (abonnements.length === 0) return;
> > > > >
> > > > >   const notification = {
> > > > >     title: payload.titre || config.titre,
> > > > >     body: payload.corps || '',
> > > > >     icon: config.icone,
> > > > >     badge: config.badge,
> > > > >     vibrate: config.vibration,
> > > > >     tag: type, // remplace une notif du même type si déjà présente
> > > > >     renotify: config.priorite === 'high',
> > > > >     requireInteraction: config.priorite === 'high',
> > > > >     data: {
> > > > >       type,
> > > > >       url: payload.url || '/',
> > > > >       ...payload.data
> > > > >     },
> > > > >     actions: payload.actions || []
> > > > >   };
> > > > >
> > > > >   const resultats = await Promise.allSettled(
> > > > >     abonnements.map(async (sub) => {
> > > > >       const subscription = {
> > > > >         endpoint: sub.endpoint,
> > > > >         keys: { p256dh: sub.p256dh, auth: sub.auth }
> > > > >       };
> > > > >
> > > > >       try {
> > > > >         await webpush.sendNotification(
> > > > >           subscription,
> > > > >           JSON.stringify(notification),
> > > > >           { TTL: config.priorite === 'high' ? 86400 : 3600 }
> > > > >         );
> > > > >
> > > > >         // Mettre à jour last_used_at
> > > > >         db.prepare(`
> > > > >           UPDATE push_subscriptions SET last_used_at = CURRENT_TIMESTAMP
> > > > >           WHERE id = ?
> > > > >         `).run(sub.id);
> > > > >
> > > > >         return { succes: true, sub_id: sub.id };
> > > > >
> > > > >       } catch (err) {
> > > > >         // Abonnement expiré ou invalide → désactiver
> > > > >         if (err.statusCode === 410 || err.statusCode === 404) {
> > > > >           db.prepare(`
> > > > >             UPDATE push_subscriptions SET actif = 0 WHERE id = ?
> > > > >           `).run(sub.id);
> > > > >         }
> > > > >         throw err;
> > > > >       }
> > > > >     })
> > > > >   );
> > > > >
> > > > >   // Logger le résultat
> > > > >   const succes = resultats.filter(r => r.status === 'fulfilled').length;
> > > > >   const echecs = resultats.filter(r => r.status === 'rejected').length;
> > > > >
> > > > >   db.prepare(`
> > > > >     INSERT INTO push_logs
> > > > >       (user_id, type_notif, titre, corps, data, statut, erreur)
> > > > >     VALUES (?, ?, ?, ?, ?, ?, ?)
> > > > >   `).run(
> > > > >     user_id, type,
> > > > >     notification.title,
> > > > >     notification.body,
> > > > >     JSON.stringify(payload.data || {}),
> > > > >     echecs === abonnements.length ? 'echoue' : 'envoye',
> > > > >     echecs > 0 ? `${echecs}/${abonnements.length} échoués` : null
> > > > >   );
> > > > > }
> > > > >
> > > > > /**
> > > > >  * Envoi groupé à plusieurs utilisateurs
> > > > >  */
> > > > > async function envoyerPushGroupe(user_ids, type, payload) {
> > > > >   await Promise.allSettled(
> > > > >     user_ids.map(id => envoyerPush(id, type, payload))
> > > > >   );
> > > > > }
> > > > >
> > > > > module.exports = {
> > > > >   envoyerPush,
> > > > >   envoyerPushGroupe,
> > > > >   NOTIF_CONFIG
> > > > > };
> > > > >
> > > > > ```
> > > > >
> > > > > ---
> > > > >
> > > > > **PHASE 4 — Routes backend push**
> > > > >
> > > > > ```js
> > > > > // POST /api/push/subscribe
> > > > > // Enregistrer un abonnement push pour l'utilisateur connecté
> > > > > router.post('/api/push/subscribe', middlewareAuth, (req, res) => {
> > > > >   const { endpoint, keys } = req.body;
> > > > >   const { p256dh, auth } = keys;
> > > > >   const user_agent = req.headers['user-agent'];
> > > > >
> > > > >   db.prepare(`
> > > > >     INSERT INTO push_subscriptions
> > > > >       (user_id, endpoint, p256dh, auth, user_agent)
> > > > >     VALUES (?, ?, ?, ?, ?)
> > > > >     ON CONFLICT(user_id, endpoint) DO UPDATE SET
> > > > >       p256dh = ?, auth = ?, actif = 1,
> > > > >       last_used_at = CURRENT_TIMESTAMP
> > > > >   `).run(
> > > > >     req.user.id, endpoint, p256dh, auth, user_agent,
> > > > >     p256dh, auth
> > > > >   );
> > > > >
> > > > >   // Initialiser les préférences si première fois
> > > > >   db.prepare(`
> > > > >     INSERT OR IGNORE INTO notif_preferences (user_id)
> > > > >     VALUES (?)
> > > > >   `).run(req.user.id);
> > > > >
> > > > >   res.json({ success: true });
> > > > > });
> > > > >
> > > > > // DELETE /api/push/unsubscribe
> > > > > // Désabonner l'appareil actuel
> > > > > router.delete('/api/push/unsubscribe', middlewareAuth, (req, res) => {
> > > > >   const { endpoint } = req.body;
> > > > >   db.prepare(`
> > > > >     UPDATE push_subscriptions SET actif = 0
> > > > >     WHERE user_id = ? AND endpoint = ?
> > > > >   `).run(req.user.id, endpoint);
> > > > >   res.json({ success: true });
> > > > > });
> > > > >
> > > > > // GET /api/push/vapid-key
> > > > > // Retourner la clé publique VAPID au frontend
> > > > > router.get('/api/push/vapid-key', (req, res) => {
> > > > >   res.json({ publicKey: process.env.VAPID_PUBLIC_KEY });
> > > > > });
> > > > >
> > > > > // GET /api/push/preferences
> > > > > router.get('/api/push/preferences', middlewareAuth, (req, res) => {
> > > > >   const prefs = db.prepare(`
> > > > >     SELECT * FROM notif_preferences WHERE user_id = ?
> > > > >   `).get(req.user.id) || {};
> > > > >   res.json(prefs);
> > > > > });
> > > > >
> > > > > // PATCH /api/push/preferences
> > > > > router.patch('/api/push/preferences', middlewareAuth, (req, res) => {
> > > > >   const champs = Object.keys(req.body)
> > > > >     .filter(k => k.startsWith('push_'))
> > > > >     .map(k => `${k} = ?`)
> > > > >     .join(', ');
> > > > >   const valeurs = Object.keys(req.body)
> > > > >     .filter(k => k.startsWith('push_'))
> > > > >     .map(k => req.body[k]);
> > > > >
> > > > >   if (champs.length === 0) return res.json({ success: true });
> > > > >
> > > > >   db.prepare(`
> > > > >     INSERT INTO notif_preferences (user_id) VALUES (?)
> > > > >     ON CONFLICT(user_id) DO UPDATE SET ${champs}, updated_at = CURRENT_TIMESTAMP
> > > > >   `).run(req.user.id, ...valeurs);
> > > > >
> > > > >   res.json({ success: true });
> > > > > });
> > > > >
> > > > > // GET /api/push/logs (superadmin seulement)
> > > > > router.get('/api/push/logs', requireRole('super_admin'), (req, res) => {
> > > > >   const { user_id, type, limit = 50 } = req.query;
> > > > >   let query = `
> > > > >     SELECT pl.*, u.prenom, u.nom, u.role
> > > > >     FROM push_logs pl
> > > > >     JOIN users u ON u.id = pl.user_id
> > > > >     WHERE 1=1
> > > > >   `;
> > > > >   const params = [];
> > > > >   if (user_id) { query += ` AND pl.user_id = ?`; params.push(user_id); }
> > > > >   if (type) { query += ` AND pl.type_notif = ?`; params.push(type); }
> > > > >   query += ` ORDER BY pl.created_at DESC LIMIT ?`;
> > > > >   params.push(parseInt(limit));
> > > > >
> > > > >   res.json(db.prepare(query).all(...params));
> > > > > });
> > > > >
> > > > > ```
> > > > >
> > > > > ---
> > > > >
> > > > > **PHASE 5 — Intégration dans les services existants**
> > > > >
> > > > > Ajouter `envoyerPush` dans chaque service, toujours après les transactions et après WhatsApp :
> > > > >
> > > > > ```js
> > > > > const { envoyerPush, envoyerPushGroupe } = require('./pushService');
> > > > >
> > > > > // ─── Dans notificationService.js ───
> > > > >
> > > > > // Après envoyerConfirmation() → Push joueur
> > > > > await envoyerPush(data.joueur_id, 'RESA_CONFIRMEE', {
> > > > >   corps: `${data.terrain_nom} · ${formaterDate(data.date)} à ${formaterHeure(data.heure_debut)}`,
> > > > >   url: `/mes-reservations/${reservationId}`,
> > > > >   actions: [{ action: 'voir', title: 'Voir ma résa' }],
> > > > >   data: { reservation_id: reservationId }
> > > > > });
> > > > >
> > > > > // + Push gérant de garde
> > > > > const gerant = getGerantDeGarde(terrain_id);
> > > > > if (gerant) {
> > > > >   await envoyerPush(gerant.gerant_id, 'NOUVELLE_RESA', {
> > > > >     corps: `${data.joueur_prenom} · ${formaterDate(data.date)} à ${formaterHeure(data.heure_debut)}`,
> > > > >     url: `/backoffice/gerant`,
> > > > >     data: { reservation_id: reservationId }
> > > > >   });
> > > > > }
> > > > >
> > > > > // Après envoyerRemboursement() → Push joueur
> > > > > await envoyerPush(joueur_id, 'RESA_ANNULEE_CONFLIT', {
> > > > >   corps: 'Quelqu\'un a payé en premier. Remboursement en cours.',
> > > > >   url: `/terrains/${terrain_id}`,
> > > > >   data: { terrain_id }
> > > > > });
> > > > >
> > > > > // Après reversement gérant → Push gérant
> > > > > await envoyerPush(gerant_id, 'REVERSEMENT_CREDITE', {
> > > > >   corps: `${formaterMontant(montantReverse)} crédités`,
> > > > >   url: `/backoffice/gerant/finances`,
> > > > >   data: { montant: montantReverse }
> > > > > });
> > > > >
> > > > > // Après annulation réservation par gérant → Push joueur
> > > > > await envoyerPush(joueur_id, 'RESA_ANNULEE_GERANT', {
> > > > >   corps: `${terrain_nom} · ${formaterDate(date)}`,
> > > > >   url: `/mes-reservations`,
> > > > >   data: { reservation_id: reservationId }
> > > > > });
> > > > >
> > > > > // ─── Dans scoreService.js ───
> > > > >
> > > > > // Quand score passe en orange (50-75)
> > > > > if (score < 75 && scoreAvant >= 75) {
> > > > >   const proprio = getProprietaireTerrain(terrain_id);
> > > > >   if (proprio) {
> > > > >     await envoyerPush(proprio.id, 'SANTE_ORANGE', {
> > > > >       corps: `Score de ${gerant_prenom} à ${score}/100 sur ${terrain_nom}`,
> > > > >       url: `/backoffice/proprietaire/sante`,
> > > > >       data: { terrain_id }
> > > > >     });
> > > > >   }
> > > > > }
> > > > >
> > > > > // Quand score passe en rouge (< 50)
> > > > > if (score < 50 && scoreAvant >= 50) {
> > > > >   const proprio = getProprietaireTerrain(terrain_id);
> > > > >   if (proprio) {
> > > > >     await envoyerPush(proprio.id, 'SANTE_ROUGE', {
> > > > >       corps: `Score de ${gerant_prenom} à ${score}/100 — attention requise`,
> > > > >       url: `/backoffice/proprietaire/sante`,
> > > > >       data: { terrain_id }
> > > > >     });
> > > > >   }
> > > > >   // Super admin aussi
> > > > >   const admins = getSuperAdmins();
> > > > >   await envoyerPushGroupe(admins.map(a => a.id), 'SCORE_CRITIQUE_ADMIN', {
> > > > >     corps: `${terrain_nom} — gérant : ${gerant_prenom}`,
> > > > >     url: `/backoffice/superadmin/terrains/${terrain_id}`,
> > > > >     data: { terrain_id }
> > > > >   });
> > > > > }
> > > > >
> > > > > // ─── Dans les jobs cron ───
> > > > >
> > > > > // Rappel match H-2 (cron toutes les 30 min)
> > > > > cron.schedule('*/30 * * * *', async () => {
> > > > >   const dans2h = new Date(Date.now() + 2 * 3600000);
> > > > >   const matchs = db.prepare(`
> > > > >     SELECT r.joueur_id, r.id, t.nom, c.date, c.heure_debut
> > > > >     FROM reservations r
> > > > >     JOIN creneaux c ON c.id = r.creneau_id
> > > > >     JOIN terrains t ON t.id = c.terrain_id
> > > > >     WHERE r.statut = 'confirme'
> > > > >       AND datetime(c.date || ' ' || c.heure_debut)
> > > > >           BETWEEN datetime('now', '+1 hour 45 minutes')
> > > > >           AND datetime('now', '+2 hours 15 minutes')
> > > > >   `).all();
> > > > >
> > > > >   for (const m of matchs) {
> > > > >     await envoyerPush(m.joueur_id, 'RAPPEL_MATCH_H2', {
> > > > >       corps: `${m.nom} · ${formaterHeure(m.heure_debut)}`,
> > > > >       url: `/mes-reservations/${m.id}`,
> > > > >       actions: [{ action: 'qr', title: 'Voir mon QR code' }],
> > > > >       data: { reservation_id: m.id }
> > > > >     });
> > > > >   }
> > > > > });
> > > > >
> > > > > // Rappel match J-1 (cron chaque soir à 20h)
> > > > > cron.schedule('0 20 * * *', async () => {
> > > > >   const demain = new Date();
> > > > >   demain.setDate(demain.getDate() + 1);
> > > > >   const dateDemain = demain.toISOString().split('T')[0];
> > > > >
> > > > >   const matchs = db.prepare(`
> > > > >     SELECT r.joueur_id, r.id, t.nom, c.heure_debut
> > > > >     FROM reservations r
> > > > >     JOIN creneaux c ON c.id = r.creneau_id
> > > > >     JOIN terrains t ON t.id = c.terrain_id
> > > > >     WHERE r.statut = 'confirme' AND c.date = ?
> > > > >   `).all(dateDemain);
> > > > >
> > > > >   for (const m of matchs) {
> > > > >     await envoyerPush(m.joueur_id, 'RAPPEL_MATCH_J1', {
> > > > >       corps: `${m.nom} · demain à ${formaterHeure(m.heure_debut)}`,
> > > > >       url: `/mes-reservations/${m.id}`,
> > > > >       data: { reservation_id: m.id }
> > > > >     });
> > > > >   }
> > > > > });
> > > > >
> > > > > // Match imminent gérant (cron toutes les 15 min)
> > > > > cron.schedule('*/15 * * * *', async () => {
> > > > >   const dans30min = new Date(Date.now() + 30 * 60000);
> > > > >   const matchs = db.prepare(`
> > > > >     SELECT r.id, gt.gerant_id, t.nom, c.date, c.heure_debut
> > > > >     FROM reservations r
> > > > >     JOIN creneaux c ON c.id = r.creneau_id
> > > > >     JOIN terrains t ON t.id = c.terrain_id
> > > > >     JOIN gerants_terrains gt ON gt.terrain_id = t.id
> > > > >     WHERE r.statut = 'confirme'
> > > > >       AND r.qr_code_scanne_at IS NULL
> > > > >       AND datetime(c.date || ' ' || c.heure_debut)
> > > > >           BETWEEN datetime('now', '+25 minutes')
> > > > >           AND datetime('now', '+35 minutes')
> > > > >   `).all();
> > > > >
> > > > >   for (const m of matchs) {
> > > > >     await envoyerPush(m.gerant_id, 'MATCH_IMMINENT', {
> > > > >       corps: `${m.nom} · dans 30 min`,
> > > > >       url: `/backoffice/gerant`,
> > > > >       actions: [{ action: 'scanner', title: 'Ouvrir le scanner' }],
> > > > >       data: { reservation_id: m.id }
> > > > >     });
> > > > >   }
> > > > > });
> > > > >
> > > > > // Rappels dette commission (cron chaque matin à 9h)
> > > > > cron.schedule('0 9 * * *', async () => {
> > > > >   const dettes = db.prepare(`
> > > > >     SELECT rdp.*, gt.gerant_id,
> > > > >       CAST(julianday(rdp.date_echeance) - julianday('now') AS INTEGER)
> > > > >         as jours_restants
> > > > >     FROM resume_dette_periode rdp
> > > > >     JOIN gerants_terrains gt ON gt.terrain_id = rdp.terrain_id
> > > > >     WHERE rdp.solde_restant > 0
> > > > >   `).all();
> > > > >
> > > > >   for (const d of dettes) {
> > > > >     if (d.jours_restants === 7 && !d.notif_j7_envoyee) {
> > > > >       await envoyerPush(d.gerant_id, 'DETTE_RAPPEL_J7', {
> > > > >         corps: `${formaterMontant(d.solde_restant)} à régler`,
> > > > >         url: `/backoffice/gerant/finances`,
> > > > >         data: { periode: d.periode }
> > > > >       });
> > > > >       db.prepare(`
> > > > >         UPDATE resume_dette_periode
> > > > >         SET notif_j7_envoyee = 1 WHERE id = ?
> > > > >       `).run(d.id);
> > > > >     }
> > > > >     if (d.jours_restants === 3 && !d.notif_j3_envoyee) {
> > > > >       await envoyerPush(d.gerant_id, 'DETTE_RAPPEL_J3', {
> > > > >         corps: `${formaterMontant(d.solde_restant)} — plus que 3 jours`,
> > > > >         url: `/backoffice/gerant/finances`,
> > > > >         data: { periode: d.periode }
> > > > >       });
> > > > >       db.prepare(`
> > > > >         UPDATE resume_dette_periode
> > > > >         SET notif_j3_envoyee = 1 WHERE id = ?
> > > > >       `).run(d.id);
> > > > >     }
> > > > >     if (d.jours_restants === 1 && !d.notif_j1_envoyee) {
> > > > >       await envoyerPush(d.gerant_id, 'DETTE_RAPPEL_J1', {
> > > > >         corps: `${formaterMontant(d.solde_restant)} — dernier délai demain`,
> > > > >         url: `/backoffice/gerant/finances`,
> > > > >         data: { periode: d.periode }
> > > > >       });
> > > > >       db.prepare(`
> > > > >         UPDATE resume_dette_periode
> > > > >         SET notif_j1_envoyee = 1 WHERE id = ?
> > > > >       `).run(d.id);
> > > > >     }
> > > > >     if (d.jours_restants < 0) {
> > > > >       await envoyerPush(d.gerant_id, 'DETTE_RETARD', {
> > > > >         corps: `${formaterMontant(d.solde_restant)} en retard`,
> > > > >         url: `/backoffice/gerant/finances`,
> > > > >         data: { periode: d.periode }
> > > > >       });
> > > > >       // Super admin aussi
> > > > >       const admins = getSuperAdmins();
> > > > >       await envoyerPushGroupe(
> > > > >         admins.map(a => a.id), 'DETTE_RETARD_ADMIN',
> > > > >         { corps: `${d.terrain_nom} — gérant`, url: '/backoffice/superadmin/caisse' }
> > > > >       );
> > > > >     }
> > > > >   }
> > > > > });
> > > > >
> > > > > // Demande de retrait → Super admin
> > > > > // (à ajouter après la création d'une demande_retrait)
> > > > > const admins = getSuperAdmins();
> > > > > await envoyerPushGroupe(admins.map(a => a.id), 'RETRAIT_DEMANDE', {
> > > > >   corps: `${gerant_nom} · ${terrain_nom} · ${formaterMontant(montant)}`,
> > > > >   url: '/backoffice/superadmin/caisse',
> > > > >   actions: [{ action: 'traiter', title: 'Traiter' }],
> > > > >   data: { demande_id: demandeId }
> > > > > });
> > > > >
> > > > > ```
> > > > >
> > > > > ---
> > > > >
> > > > > **PHASE 6 — Service Worker : gestion des push reçus**
> > > > >
> > > > > Étendre `sw.js` existant sans casser ce qui est en place :
> > > > >
> > > > > ```js
> > > > > // ─── Ajouter à la FIN du sw.js existant ───
> > > > >
> > > > > // Réception d'une notification push
> > > > > self.addEventListener('push', (event) => {
> > > > >   if (!event.data) return;
> > > > >
> > > > >   const notif = event.data.json();
> > > > >
> > > > >   const options = {
> > > > >     body: notif.body,
> > > > >     icon: notif.icon || '/icons/icon-192.png',
> > > > >     badge: notif.badge || '/icons/badge-72.png',
> > > > >     vibrate: notif.vibrate || [200],
> > > > >     tag: notif.tag || 'terrainsn',
> > > > >     renotify: notif.renotify || false,
> > > > >     requireInteraction: notif.requireInteraction || false,
> > > > >     data: notif.data || {},
> > > > >     actions: notif.actions || []
> > > > >   };
> > > > >
> > > > >   event.waitUntil(
> > > > >     self.registration.showNotification(notif.title, options)
> > > > >   );
> > > > > });
> > > > >
> > > > > // Clic sur une notification
> > > > > self.addEventListener('notificationclick', (event) => {
> > > > >   event.notification.close();
> > > > >
> > > > >   const data = event.notification.data || {};
> > > > >   const action = event.action;
> > > > >
> > > > >   let url = data.url || '/';
> > > > >
> > > > >   // Navigation selon l'action cliquée
> > > > >   if (action === 'voir' || action === 'traiter') {
> > > > >     url = data.url || '/';
> > > > >   } else if (action === 'scanner') {
> > > > >     url = '/backoffice/gerant#scanner';
> > > > >   } else if (action === 'qr') {
> > > > >     url = data.url || '/mes-reservations';
> > > > >   }
> > > > >
> > > > >   event.waitUntil(
> > > > >     clients.matchAll({ type: 'window', includeUncontrolled: true })
> > > > >       .then((clientList) => {
> > > > >         // Si l'app est déjà ouverte → focus et navigate
> > > > >         for (const client of clientList) {
> > > > >           if (client.url.includes(self.location.origin) && 'focus' in client) {
> > > > >             client.focus();
> > > > >             return client.navigate(url);
> > > > >           }
> > > > >         }
> > > > >         // Sinon → ouvrir un nouvel onglet
> > > > >         return clients.openWindow(url);
> > > > >       })
> > > > >   );
> > > > > });
> > > > >
> > > > > // Fermeture d'une notification (pour les stats)
> > > > > self.addEventListener('notificationclose', (event) => {
> > > > >   // On pourrait logger ici si nécessaire
> > > > >   // Pour l'instant on ne fait rien
> > > > > });
> > > > >
> > > > > ```
> > > > >
> > > > > ---
> > > > >
> > > > > **PHASE 7 — Hook frontend** `usePushNotifications.ts`
> > > > >
> > > > > ```tsx
> > > > > // hooks/usePushNotifications.ts
> > > > >
> > > > > export function usePushNotifications() {
> > > > >   const [statut, setStatut] = useState
> > > > >     'non_supporte' | 'non_demande' | 'accorde' | 'refuse' | 'loading'
> > > > >   >('loading');
> > > > >   const [subscription, setSubscription] = useState<PushSubscription | null>(null);
> > > > >
> > > > >   useEffect(() => {
> > > > >     verifierStatut();
> > > > >   }, []);
> > > > >
> > > > >   async function verifierStatut() {
> > > > >     if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
> > > > >       setStatut('non_supporte');
> > > > >       return;
> > > > >     }
> > > > >
> > > > >     const permission = Notification.permission;
> > > > >     if (permission === 'denied') {
> > > > >       setStatut('refuse');
> > > > >       return;
> > > > >     }
> > > > >     if (permission === 'granted') {
> > > > >       const sw = await navigator.serviceWorker.ready;
> > > > >       const sub = await sw.pushManager.getSubscription();
> > > > >       if (sub) {
> > > > >         setSubscription(sub);
> > > > >         setStatut('accorde');
> > > > >       } else {
> > > > >         setStatut('non_demande');
> > > > >       }
> > > > >       return;
> > > > >     }
> > > > >     setStatut('non_demande');
> > > > >   }
> > > > >
> > > > >   async function demanderPermission() {
> > > > >     try {
> > > > >       const permission = await Notification.requestPermission();
> > > > >       if (permission !== 'granted') {
> > > > >         setStatut('refuse');
> > > > >         return false;
> > > > >       }
> > > > >
> > > > >       // Récupérer la clé VAPID publique
> > > > >       const res = await fetch('/api/push/vapid-key');
> > > > >       const { publicKey } = await res.json();
> > > > >
> > > > >       const sw = await navigator.serviceWorker.ready;
> > > > >       const sub = await sw.pushManager.subscribe({
> > > > >         userVisibleOnly: true,
> > > > >         applicationServerKey: urlBase64ToUint8Array(publicKey)
> > > > >       });
> > > > >
> > > > >       // Enregistrer en DB
> > > > >       await fetch('/api/push/subscribe', {
> > > > >         method: 'POST',
> > > > >         headers: {
> > > > >           'Content-Type': 'application/json',
> > > > >           Authorization: `Bearer ${localStorage.getItem('access_token')}`
> > > > >         },
> > > > >         body: JSON.stringify(sub.toJSON())
> > > > >       });
> > > > >
> > > > >       setSubscription(sub);
> > > > >       setStatut('accorde');
> > > > >       return true;
> > > > >     } catch (err) {
> > > > >       console.error('[Push] Erreur activation:', err);
> > > > >       setStatut('refuse');
> > > > >       return false;
> > > > >     }
> > > > >   }
> > > > >
> > > > >   async function seDesabonner() {
> > > > >     if (!subscription) return;
> > > > >     await fetch('/api/push/unsubscribe', {
> > > > >       method: 'DELETE',
> > > > >       headers: {
> > > > >         'Content-Type': 'application/json',
> > > > >         Authorization: `Bearer ${localStorage.getItem('access_token')}`
> > > > >       },
> > > > >       body: JSON.stringify({ endpoint: subscription.endpoint })
> > > > >     });
> > > > >     await subscription.unsubscribe();
> > > > >     setSubscription(null);
> > > > >     setStatut('non_demande');
> > > > >   }
> > > > >
> > > > >   return { statut, subscription, demanderPermission, seDesabonner };
> > > > > }
> > > > >
> > > > > // Convertir clé VAPID base64 en Uint8Array
> > > > > function urlBase64ToUint8Array(base64String: string) {
> > > > >   const padding = '='.repeat((4 - base64String.length % 4) % 4);
> > > > >   const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
> > > > >   const rawData = window.atob(base64);
> > > > >   return Uint8Array.from([...rawData].map(c => c.charCodeAt(0)));
> > > > > }
> > > > >
> > > > > ```
> > > > >
> > > > > ---
> > > > >
> > > > > **PHASE 8 — UI : demande de permission et préférences**
> > > > >
> > > > > **Bannière de demande de permission (première connexion) :**
> > > > >
> > > > > ```tsx
> > > > > // components/PushPermissionBanner.tsx
> > > > > // Affiché une seule fois après la connexion si statut = 'non_demande'
> > > > > // Stocké en localStorage pour ne pas redemander
> > > > >
> > > > > export const PushPermissionBanner = () => {
> > > > >   const { statut, demanderPermission } = usePushNotifications();
> > > > >   const [masque, setMasque] = useState(
> > > > >     localStorage.getItem('push_banner_masque') === '1'
> > > > >   );
> > > > >
> > > > >   if (statut !== 'non_demande' || masque) return null;
> > > > >
> > > > >   const handleActiver = async () => {
> > > > >     const ok = await demanderPermission();
> > > > >     if (ok) {
> > > > >       localStorage.setItem('push_banner_masque', '1');
> > > > >       setMasque(true);
> > > > >     }
> > > > >   };
> > > > >
> > > > >   const handleIgnorer = () => {
> > > > >     localStorage.setItem('push_banner_masque', '1');
> > > > >     setMasque(true);
> > > > >   };
> > > > >
> > > > >   return (
> > > > >     <div className="fixed bottom-20 left-4 right-4 z-50 md:left-auto md:right-6 md:w-96">
> > > > >       <div
> > > > >         className="rounded-xl p-4 flex flex-col gap-3"
> > > > >         style={{
> > > > >           background: 'var(--color-surface)',
> > > > >           border: '1px solid var(--color-border)',
> > > > >           boxShadow: 'var(--shadow-lg)'
> > > > >         }}
> > > > >       >
> > > > >         <div className="flex items-start gap-3">
> > > > >           <div
> > > > >             className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0"
> > > > >             style={{ background: 'var(--primary-glow)' }}
> > > > >           >
> > > > >             <Bell className="w-5 h-5" style={{ color: 'var(--primary)' }} />
> > > > >           </div>
> > > > >           <div>
> > > > >             <p className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>
> > > > >               Activer les notifications
> > > > >             </p>
> > > > >             <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
> > > > >               Reçois les confirmations de réservation
> > > > >               et rappels de matchs directement sur ton téléphone.
> > > > >             </p>
> > > > >           </div>
> > > > >         </div>
> > > > >         <div className="flex gap-2">
> > > > >           <button
> > > > >             onClick={handleActiver}
> > > > >             className="flex-1 py-2 rounded-lg text-sm font-semibold text-white btn-press"
> > > > >             style={{ background: 'var(--primary)' }}
> > > > >           >
> > > > >             Activer
> > > > >           </button>
> > > > >           <button
> > > > >             onClick={handleIgnorer}
> > > > >             className="px-4 py-2 rounded-lg text-sm"
> > > > >             style={{
> > > > >               background: 'var(--color-surface-2)',
> > > > >               color: 'var(--text-muted)'
> > > > >             }}
> > > > >           >
> > > > >             Plus tard
> > > > >           </button>
> > > > >         </div>
> > > > >       </div>
> > > > >     </div>
> > > > >   );
> > > > > };
> > > > >
> > > > > ```
> > > > >
> > > > > **Section préférences notifications dans les Paramètres (tous les rôles) :**
> > > > >
> > > > > ```
> > > > > SECTION "Notifications push"
> > > > >   Dans Paramètres > Notifications (section existante)
> > > > >
> > > > >   STATUT DE CONNEXION
> > > > >     Si accorde :
> > > > >       Point vert + "Notifications actives sur cet appareil"
> > > > >       Bouton "Désactiver" outline rouge
> > > > >     Si non_demande :
> > > > >       Point gris + "Notifications non activées"
> > > > >       Bouton "Activer les notifications" vert
> > > > >     Si refuse :
> > > > >       Point rouge + "Notifications bloquées par le navigateur"
> > > > >       Texte 12px muted : "Pour les activer, modifie les paramètres
> > > > >         de ton navigateur pour ce site."
> > > > >     Si non_supporte :
> > > > >       Point gris + "Non supporté sur cet appareil"
> > > > >
> > > > >   PRÉFÉRENCES (si accorde)
> > > > >     Toggles selon le rôle de l'utilisateur :
> > > > >
> > > > >     JOUEUR :
> > > > >       "Confirmations de réservation" (push_resa_confirmee)
> > > > >       "Annulations" (push_resa_annulee)
> > > > >       "Rappels de match" (push_rappel_match)
> > > > >       "Remboursements" (push_remboursement)
> > > > >
> > > > >     GÉRANT :
> > > > >       "Nouvelles réservations" (push_nouvelle_resa)
> > > > >       "Match imminent — rappel scanner" (push_match_imminent)
> > > > >       "Virements reçus" (push_reversement)
> > > > >       "Rappels dette commission" (push_dette_rappel)
> > > > >
> > > > >     PROPRIÉTAIRE :
> > > > >       "Matchs confirmés" (push_revenus)
> > > > >       "Santé gérant" (push_sante_gerant)
> > > > >       "Abonnement plateforme" (push_abonnement)
> > > > >
> > > > >     SUPER ADMIN :
> > > > >       "Demandes de retrait" (push_retrait_demande)
> > > > >       "Payouts en échec" (push_payout_echec)
> > > > >       "Alertes terrains" (push_alertes_terrain)
> > > > >
> > > > >     Chaque toggle → PATCH /api/push/preferences en temps réel
> > > > >     Pas de bouton Enregistrer — sauvegarde immédiate
> > > > >
> > > > > ```
> > > > >
> > > > > **Page audit notifications push (superadmin) :**
> > > > >
> > > > > ```
> > > > > Dans /backoffice/superadmin/audit → onglet "Push"
> > > > >
> > > > > Filtres : utilisateur | type | statut | période
> > > > > Table : Date | Utilisateur | Rôle | Type | Corps | Statut
> > > > > Badge statut : Envoyé vert | Échoué rouge | Cliqué bleu
> > > > >
> > > > > ```
> > > > >
> > > > > ---
> > > > >
> > > > > **Règles absolues :**
> > > > >
> > > > > ```
> > > > > Les push sont TOUJOURS envoyés après les transactions SQLite
> > > > >   et après les WhatsApp — jamais dedans
> > > > > Un push en échec ne doit jamais faire planter le flux principal
> > > > >   (try/catch autour de chaque envoyerPush)
> > > > > Les abonnements expirés (410/404) sont désactivés automatiquement
> > > > > tag: type dans les options → évite les doublons
> > > > >   si plusieurs notifications du même type arrivent rapidement
> > > > > requireInteraction: true uniquement pour les push haute priorité
> > > > >   (évite de surcharger l'utilisateur)
> > > > > Le service worker existant n'est pas réécrit — seulement étendu
> > > > > Aucune couleur hardcodée dans les composants
> > > > > Fournir le code complet de chaque fichier modifié
> > > > >
> > > > > ```
> > > > >
> > > > > ---
> > > > >
> > > > > **Livrable dans l'ordre :**
> > > > >
> > > > > 1. Rapport audit service worker + manifest existants
> > > > > 2. Migration SQL →
> > > > > 3. `pushService.js` complet →
> > > > > 4. Routes backend push →
> > > > > 5. Intégration dans `notificationService.js` → 
> > > > > 6. Intégration dans les jobs cron → validation
> > > > > 7. Extension `sw.js` → 
> > > > > 8. `usePushNotifications.ts` → 
> > > > > 9. `PushPermissionBanner.tsx` → 
> > > > > 10. Section préférences dans Paramètres (tous rôles) →

