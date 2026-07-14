---

> **Rôle**
> Tu es un ingénieur senior fullstack et auditeur technique avec 15 ans d'expérience en mise en production d'applications web. Tu es rigoureux, méthodique et tu ne corriges rien sans avoir d'abord tout analysé et validé.
>
> ---
>
> **Règle absolue**
> Phase 1 et 2 : lecture et audit uniquement, zéro modification. Phase 3 : corrections backend uniquement après ma validation. Phase 4 : tu génères un prompt pour Cursor, tu ne touches pas au frontend toi-même.
>
> ---
>
> **PHASE 1 — Audit complet du système**
>
> Scanne l'intégralité du projet, fichier par fichier. Produis un rapport structuré couvrant ces 8 dimensions :
>
> **1. Sécurité**
> - Variables sensibles exposées côté client ou en dur dans le code
> - Routes sans authentification qui devraient en avoir
> - Absence de validation des entrées utilisateur (injection SQL, XSS)
> - Hash SHA256 du webhook PayTech vérifié ou non
> - Tokens JWT : expiration, stockage, révocation
> - Mots de passe hashés avec bcrypt ou non
> - CORS mal configuré
> - Rate limiting absent sur les routes sensibles (login, OTP)
>
> **2. Base de données**
> - Colonnes manquantes par rapport au schéma de référence
> - Absence d'index sur les colonnes fréquemment requêtées (telephone, creneau_id, statut)
> - Transactions atomiques manquantes sur les opérations critiques
> - WAL mode et busy_timeout activés ou non
> - Contraintes FK manquantes
>
> **3. Logique métier**
> - Flow de réservation complet et cohérent
> - Gestion des conflits de créneaux simultanés
> - Job de nettoyage des verrous expirés présent et fonctionnel
> - Calcul et enregistrement de la commission
> - Reversement immédiat au gérant après confirmation
> - Remboursement PayTech en cas de conflit
>
> **4. Intégrations externes**
> - PayTech : appel correct, hash vérifié, switch simulation/production en place
> - WhatsApp `whatsapp-web.js` : client initialisé une seule fois, session persistante
> - Toutes les notifications implémentées : confirmation, remboursement, lien paiement, reversement gérant
>
> **5. Performance**
> - Index manquants
> - Requêtes N+1 détectées
> - Absence de pagination sur les listes
> - Pas de gestion du cas où `whatsapp-web.js` n'est pas connecté
>
> **6. Gestion des erreurs**
> - Try/catch manquants sur les appels externes (PayTech, WhatsApp)
> - Erreurs non loguées
> - Réponses d'erreur inconsistantes (parfois 200 avec erreur dans le body)
> - Pas de fallback si WhatsApp est déconnecté
>
> **7. Tests fonctionnels — exécuter chaque scénario et noter le résultat**
>
> Pour chaque test, noter : ✅ Fonctionne / ❌ Échoue / ⚠️ Partiel
>
> ```
> AUTH
> [ ] Inscription joueur avec numéro sénégalais valide
> [ ] Inscription joueur avec numéro invalide → erreur claire
> [ ] Réception OTP WhatsApp après inscription
> [ ] Vérification OTP correct → JWT retourné
> [ ] Vérification OTP expiré → erreur claire
> [ ] Connexion joueur téléphone + mot de passe
> [ ] Connexion backoffice téléphone + mot de passe
> [ ] Connexion backoffice email + mot de passe
> [ ] Connexion avec mauvais mot de passe → erreur claire
> [ ] Accès route protégée sans token → 401
> [ ] Accès route gérant avec token joueur → 403
>
> RÉSERVATION JOUEUR EN LIGNE
> [ ] Affichage créneaux libres d'un terrain
> [ ] Sélection créneau → créneau passe en en_attente_paiement
> [ ] Redirection vers page paiement (simulation)
> [ ] Simulation paiement réussi → réservation confirmée
> [ ] Simulation paiement réussi → créneau passe en reserve
> [ ] Simulation paiement réussi → code TF-XXXXXX généré
> [ ] Simulation paiement réussi → WhatsApp joueur reçu
> [ ] Simulation paiement réussi → WhatsApp gérant reçu
> [ ] Simulation paiement réussi → reversement gérant crédité
> [ ] Simulation paiement réussi → WhatsApp reversement gérant reçu
> [ ] Simulation paiement échoué → créneau reste en_attente puis libéré
> [ ] Verrou expiré après 10 min → créneau repassé en libre
>
> CONFLIT DE RÉSERVATION
> [ ] Deux réservations simultanées même créneau → un seul confirmé
> [ ] Joueur perdant → remboursement déclenché
> [ ] Joueur perdant → WhatsApp remboursement reçu avec lien créneaux dispo
>
> RÉSERVATION MANUELLE GÉRANT
> [ ] Gérant crée réservation manuelle
> [ ] Joueur reçoit WhatsApp avec lien paiement
> [ ] Verrou 2h en place
> [ ] Paiement joueur → même flow de confirmation
>
> BACKOFFICE GÉRANT
> [ ] Dashboard affiche stats du jour
> [ ] Liste créneaux affichée et modifiable
> [ ] Portefeuille gérant affiche solde correct
> [ ] Historique reversements correct
>
> BACKOFFICE PROPRIÉTAIRE
> [ ] Dashboard revenus correct
> [ ] Filtre par période fonctionnel
>
> BACKOFFICE SUPER ADMIN
> [ ] Création terrain fonctionnelle
> [ ] Création compte gérant → WhatsApp accès envoyé
> [ ] Création compte propriétaire → WhatsApp accès envoyé
> [ ] Modification acompte et commission d'un terrain
> [ ] Vue finances globales correcte
> [ ] Suspension d'un terrain → joueurs ne peuvent plus réserver
> ```
>
> **8. Prêt pour la production**
> - Fichier `.env.example` présent
> - Variables d'environnement documentées
> - Script de migration DB propre et rejouable
> - `package.json` avec scripts `start`, `dev`, `migrate`
> - Pas de `console.log` de debug en production
> - HTTPS géré ou documenté
> - Stratégie de backup SQLite documentée
>
> ---
>
> **Format du rapport — une entrée par problème :**
>
> ```
> DIMENSION   : Sécurité
> FICHIER     : routes/auth.js
> LIGNE       : 34
> PROBLÈME    : Mot de passe stocké en clair dans la base de données
> IMPACT      : Critique — blocant pour la production
> SUGGESTION  : Hasher avec bcrypt avant insertion
> CRITICITÉ   : 🔴 Bloquant / 🟡 Majeur / 🟢 Mineur
> ```
>
> À la fin du rapport, produire un **tableau de synthèse** :
>
> ```
> PRÊT POUR LA PROD ?
> 🔴 Bloquants   : X problèmes
> 🟡 Majeurs     : X problèmes
> 🟢 Mineurs     : X problèmes
>
> TESTS FONCTIONNELS
> ✅ Passés      : X / Total
> ❌ Échoués     : X / Total
> ⚠️ Partiels    : X / Total
> ```
>
> **Attends ma validation avant de passer à la phase suivante.**
>
> ---
>
> **PHASE 2 — Plan de correction backend**
>
> Sur la base du rapport, liste tous les problèmes backend classés par priorité. Pour chaque problème :
> - Ce qui doit être modifié et pourquoi
> - Ce qui doit être créé et pourquoi
> - Estimation de complexité : Simple / Moyen / Complexe
>
> Ne code rien encore. **Attends ma validation.**
>
> ---
>
> **PHASE 3 — Corrections backend**
>
> Applique toutes les corrections backend validées. Règles :
> - Fournir le fichier complet pour chaque fichier modifié, pas d'extraits partiels
> - Après chaque fichier corrigé, relancer le test fonctionnel correspondant et noter le résultat
> - Ne jamais casser la simulation de paiement existante
> - Ne jamais modifier la logique WhatsApp `whatsapp-web.js`
> - Toutes les opérations critiques dans des transactions SQLite atomiques
> - Try/catch sur tous les appels externes
> - Logger les erreurs avec le format : `[ERREUR][NomDuFichier] message — ${err.message}`
>
> Après toutes les corrections, relancer l'intégralité des tests fonctionnels et produire un **rapport de correction** :
>
> ```
> FICHIER MODIFIÉ : routes/auth.js
> PROBLÈMES CORRIGÉS : 3
> TESTS REPASSÉS : ✅ Connexion joueur / ✅ OTP expiré / ✅ Route protégée
> ```
>
> **Attends ma validation avant de passer à la phase suivante.**
>
> ---
>
> **PHASE 4 — Prompt Cursor pour les corrections frontend**
>
> Ne touche pas au frontend. Génère uniquement un prompt détaillé à donner à Cursor qui couvre :
> - La liste exacte des problèmes frontend trouvés pendant l'audit avec fichier et ligne
> - La liste exacte des tests fonctionnels frontend échoués avec le comportement attendu vs observé
> - Les corrections à apporter fichier par fichier
> - Les règles à respecter : ne pas toucher à la logique, uniquement corriger ce qui est listé
> - Le format de validation : après chaque correction, Cursor doit montrer le résultat et attendre la validation
>
> Le prompt doit être suffisamment précis pour que Cursor ne fasse aucune interprétation — chaque correction est explicitement décrite.
>
> ---
>
> **Livrable final attendu :**
> 1. Rapport d'audit complet avec tests → ma validation
> 2. Plan de correction backend → ma validation
> 3. Corrections backend appliquées + rapport de correction → ma validation
> 4. Prompt Cursor pour le frontend

---
