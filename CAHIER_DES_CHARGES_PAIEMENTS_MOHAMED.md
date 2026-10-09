# Cahier des charges — Paiements réels TerrainSN

| | |
|---|---|
| **Destinataire** | Mohamed Coulibaly (responsable paiements) |
| **Produit** | TerrainSN |
| **Document** | Cahier des charges fonctionnel — activer les paiements |
| **Version** | 1.0 |
| **Date** | 9 octobre 2026 |
| **Prestataire actuel** | **PayDunya** (PayTech prévu plus tard, même logique) |
| **Payouts pour l’instant** | **Wave uniquement** |
| **Langue** | Français clair, métier — pas de jargon technique |

---

## 1. Mission en une phrase

**Remplacer tous les paiements « fictifs / simulés » par de vrais paiements PayDunya**, en respectant **à la lettre le contrat de paiement de chaque terrain** configuré dans le super admin.

Aujourd’hui, beaucoup de boutons « Payer » ou de liens WhatsApp mènent à une **simulation**. Demain, chaque clic doit ouvrir **la page PayDunya**, où le payeur choisit Wave ou Orange Money, paie, et TerrainSN confirme automatiquement.

---

## 2. Ce qui ne marche pas vraiment aujourd’hui (à corriger)

| Endroit | Comportement actuel | Comportement attendu |
|---|---|---|
| **Joueur** — page réservation | Choix Wave / Orange Money dans l’app, puis souvent **page de simulation** | Un seul bouton **Payer** → redirection vers **PayDunya** (le choix Wave/OM se fait chez PayDunya) |
| **WhatsApp** — lien d’avance envoyé au joueur | Lien parfois local / simulé | Le lien ouvre **PayDunya** pour le **bon montant d’avance** du terrain |
| **Gérant** — bouton **Payer** sa dette commission | Appel incomplet / pas de vrai checkout | Redirection PayDunya pour régler la dette |
| **Reversement au gérant (payout)** | Comptabilité / portefeuille sans argent réel | Après la fenêtre de remboursement : envoi **Wave** du dû (avance − commission − frais selon contrat) |
| **Super admin — contrat** | Écran déjà riche ; une partie des infos peut encore vivre « à côté » du vrai moteur | **Une seule vérité** : le contrat enregistré pour le terrain guide **tous** les montants et décisions |

Babacar simplifiera l’écran joueur (un seul bouton **Payer**). Toi, Mohamed, tu assures que **derrière ce bouton**, et derrière **chaque lien / notification**, le moteur lit le contrat et ouvre PayDunya correctement.

---

## 3. Règle d’or (non négociable)

> **Aucune valeur magique en dur.**  
> Pour chaque terrain, tu lis le **contrat de paiement** (super admin → fiche terrain → onglet Contrat paiement), puis tu appliques exactement ce qui y est écrit :
> - pourcentage d’avance  
> - pourcentage de commission  
> - politique avec / sans avance  
> - numéros Wave (et OM pour l’info / tests)  
> - délai de remboursement  
> - mode de reversement (auto ou retrait)  
> - qui paie les frais de sortie  
> - délai de verrou du créneau en attente de paiement  
> - délai pour régler une dette commission  

Si deux terrains ont des contrats différents, **deux joueurs qui réservent le même jour paient des montants différents** — c’est normal et voulu.

---

## 4. Le contrat de paiement — analyse complète (à maîtriser)

Le super admin négocie et enregistre le contrat **par terrain**. Tu ne inventes rien : tu **consommes** ce contrat.

### 4.1 Politique globale : avec avance ou sans avance

| Mode | Ce que ça veut dire pour toi |
|---|---|
| **Avec avance (standard)** | Le joueur **doit** payer en ligne une avance via PayDunya avant confirmation. Commission prélevée sur cette avance. Reversement gérant possible ensuite. |
| **Sans avance (sur parole)** | Pas de paiement en ligne pour la réservation. Confirmation directe. Le joueur paie **sur place**. La commission TerrainSN s’accumule en **dette mensuelle** que le gérant règle plus tard (bouton **Payer** dette → PayDunya). |

En mode **sans avance**, tu ne crées **pas** de lien PayDunya pour la réservation joueur. Tu continues en revanche à calculer / accumuler la commission selon le %.

### 4.2 Bloc commercial

| Élément | Rôle | Exemple |
|---|---|---|
| **% avance** | Part du prix du créneau que le joueur paie **maintenant** en ligne | Prix 40 000, avance 12,5 % → **5 000 FCFA** à PayDunya |
| **Reste sur place** | Prix − avance. **Jamais** encaissé par TerrainSN en ligne | 35 000 FCFA au gérant le jour J |
| **% commission** | Part TerrainSN **uniquement sur l’avance** (pas sur les 40 000) | 10 % de 5 000 → **500 FCFA** pour TerrainSN |
| **Base gérant** | Avance − commission | 4 500 FCFA avant frais de sortie |

**Important :** le % avance et le % commission **changent d’un terrain à l’autre**. Toujours recalculer à partir du contrat du terrain de la réservation.

Aperçu type (celui du super admin, à reproduire à l’identique) :

```
Créneau          40 000 FCFA
Avance joueur     5 000 FCFA   (selon % du contrat)
Reste sur place  35 000 FCFA
Commission          500 FCFA   (selon % du contrat)
Base gérant       4 500 FCFA
```

### 4.3 Numéros du gérant (reversement)

L’argent de l’avance arrive d’abord chez **TerrainSN** (compte PayDunya plateforme).  
Ensuite, TerrainSN reverse le dû au **gérant** (pas au propriétaire).

| Champ | Usage |
|---|---|
| WhatsApp gérant | Référence ; case « même numéro pour Wave et OM » |
| **Numéro Wave** | **Canal de payout pour cette phase** (priorité absolue) |
| Numéro Orange Money | Enregistré / testable ; payout OM **plus tard** |
| Canal préféré | Wave / OM / les deux — **pour l’instant, payouts = Wave seulement** |
| Statut par canal | Non configuré → saisi → test 100 FCFA envoyé → **vérifié** |

**Règles :**
- Sans au moins un numéro **vérifié** (idéalement Wave), le joueur peut quand même payer l’avance, mais **rien ne part** vers le gérant : le dû s’accumule en attente.
- Les tests « 100 FCFA » du super admin doivent être de **vrais** petits envois (ou clairement marqués si sandbox), pas des faux succès.
- **Bénéficiaire = toujours le gérant du terrain.**

### 4.4 Politique d’annulation / remboursement

| Paramètre | Effet |
|---|---|
| **Remboursement non autorisé** | Le joueur peut annuler le match, mais **perd son avance**. Le dû gérant peut devenir payable **tout de suite** (selon le mode). |
| **Remboursement autorisé + délai X heures** | Si le joueur annule **dans les X heures** après confirmation → on **rembourse l’avance** (via PayDunya) et le gérant **ne reçoit rien** pour cette réservation. |
| **Après le délai X heures** | Plus de remboursement gratuit. Annulation possible mais **avance perdue**. C’est **à ce moment** que le dû devient **payable** et que le payout auto peut partir. |

Texte joueur (déjà préparé côté produit) :
- « Annulation sans remboursement de l’avance. »
- ou « Remboursé si tu annules dans les X h suivant ta réservation. Au-delà, l’avance est conservée. »

**Film mental :**

```
Joueur paie l’avance
        │
        ├─ Annule DANS le délai (si remboursement autorisé)
        │     → argent revient au joueur
        │     → gérant : 0
        │
        └─ Délai dépassé OU remboursement non autorisé
              → dû gérant PAYABLE
              → si mode AUTO : envoi Wave automatique (moins commission et frais)
              → si mode RETRAIT : le gérant demande un retrait (0 frais payout)
```

Le **scan QR / jour du match** encaisse le reste **sur place**. Il ne déclenche **pas** le reversement de l’avance.

### 4.5 Délai de confirmation paiement (verrou créneau)

Quand une réservation est créée **en attente de paiement**, le créneau est bloqué pendant **N minutes** (souvent 15, max 120 — valeur du contrat).

- Paiement OK dans le délai → confirmation, QR, notifications.
- Pas de paiement → créneau **libéré automatiquement**, lien devenu invalide.

Les liens WhatsApp d’avance indiquent déjà une validité courte (ex. 2 h) : le verrou technique du créneau et le message WhatsApp doivent rester **cohérents** (pas promettre 2 h si le créneau est libéré à 15 min — aligne-toi sur la règle produit / contrat).

### 4.6 Mode de reversement et frais de sortie

Deux modes, **un seul actif par terrain** :

#### Mode A — Reversement automatique (`auto`)

Dès que le dû est **payable** (après fenêtre de remboursement) :
1. Calculer le montant net selon la politique de frais.
2. Envoyer ce montant sur le **Wave du gérant** via PayDunya.
3. Marquer le dû comme versé (ou échec + alerte).

**Qui paie les frais de payout (sortie) ?** — lu dans le contrat :

| Politique | Effet |
|---|---|
| **Gérant** | Les frais sont déduits de ce qu’il reçoit |
| **Plateforme** | Le gérant reçoit la base entière ; TerrainSN assume les frais |
| **Partage** | Ex. 1 % gérant + 1 % plateforme sur la base gérant |

Exemple (mode auto, partage 1 % / 1 %) :
- Base gérant 4 500  
- Frais gérant 45 → **reçu Wave : 4 455**  
- Frais plateforme 45 → absorbés par TerrainSN  

#### Mode B — Retrait à la demande (`retrait`)

- **Aucun frais** de payout.
- Le dû s’accumule.
- Le gérant clique **Retirer** → l’équipe reçoit une alerte (WhatsApp dév) → virement manuel sur le Wave du gérant.
- Montant = avance − commission (pas de frais).

### 4.7 Dette commission (surtout mode sans avance + confirmations manuelles)

Quand TerrainSN n’a pas encaissé d’avance en ligne, la commission due s’accumule.

| Élément | Comportement |
|---|---|
| Calcul | Selon le % commission du contrat (souvent sur l’avance « théorique ») |
| Échéance | Fin de mois + **délai en jours** du contrat (ex. 30 jours, entre 7 et 90) |
| Action gérant | Bouton **Payer** dans Finances → **PayDunya** pour le montant dû |
| Après paiement confirmé | Solde dette mis à jour, message « Tout est réglé » si soldé |

### 4.8 Activation « production paiement »

Le super admin ne doit activer la production que si les blocs requis sont OK (commercial, numéros vérifiés, politique d’annulation, mode de reversement).

- Terrain **pas en production** : tu peux rester en sandbox / simulation contrôlée, mais le code de calcul doit déjà lire le contrat.
- Terrain **en production** : **plus de faux paiement** pour ce terrain — uniquement PayDunya réel (ou environnement de test PayDunya clairement identifié).

---

## 5. Les trois parcours que tu dois rendre réels

### 5.1 Parcours Joueur — « Je réserve et je paie »

**Intention :** le joueur valide sa réservation et paie son avance.

1. Il choisit terrain, date, créneau, durée.
2. L’écran lui montre :
   - prix total (selon tarifs du terrain)  
   - **avance à payer maintenant** (calculée avec le **% avance du contrat**)  
   - reste à payer sur place  
   - texte d’annulation issu du contrat  
3. Il clique sur **Payer** (un seul bouton — Babacar retire Wave/OM de l’UI app).
4. Tu :
   - verifies que le terrain autorise l’avance (pas « sans avance ») ;
   - calcules le montant exact d’avance ;
   - crées une session de paiement chez **PayDunya** pour ce montant ;
   - rediriges le joueur vers la page PayDunya ;
5. Sur PayDunya, le joueur choisit **Wave ou Orange Money** (ou autre moyen proposé par PayDunya).
6. PayDunya confirme le paiement à TerrainSN.
7. Tu confirmes la réservation, génères le code / QR, envoies les notifications (WhatsApp + push), et tu **enregistres le dû gérant** (avance, commission, base, mode, fenêtres) d’après le contrat **figé à cet instant**.

**Si le joueur abandonne ou échoue :** pas de confirmation ; créneau libéré selon le délai de verrou.

**Si le terrain est en « sans avance » :** le bouton devient « Confirmer ma réservation » sans PayDunya ; commission part en dette.

### 5.2 Parcours WhatsApp — « Le gérant m’a envoyé un lien »

**Intention :** le gérant crée une réservation (téléphone / express / file) et le joueur reçoit un message WhatsApp avec un lien.

1. Le gérant enregistre la réservation → statut « en attente de paiement ».
2. Tu génères un **vrai lien PayDunya** (montant = avance du contrat de **ce** terrain).
3. Le message WhatsApp contient ce lien (template déjà existant : salut, terrain, date, montant avance, reste sur place, validité).
4. Quand le joueur clique le lien (depuis WhatsApp) → **même page PayDunya** que s’il avait cliqué Payer dans l’app.
5. Après paiement réussi → **mêmes suites** que le parcours joueur (confirmation, QR, notifications, dû gérant).

**Synchronisation notifications (obligatoire) :**
- Le lien dans WhatsApp = le **même** lien de paiement que celui stocké pour la réservation.
- Push « lien de paiement envoyé » pointe vers la **même** réalité (pas un vieux lien mock).
- Si le lien expire / créneau libéré → message d’échec clair ; on ne laisse pas un lien mort qui « réussit » en simulation.
- Confirmation paiement → notification de confirmation **uniquement après** succès réel PayDunya (pas avant).

### 5.3 Parcours Gérant — « Je paie ma dette commission »

**Intention :** le gérant solde ce qu’il doit à TerrainSN.

1. Écran Finances / carte commission due : montant, période, échéance (délai du contrat).
2. Clic **Payer**.
3. Redirection PayDunya pour le **montant de dette** (pas l’avance joueur).
4. Après succès → mise à jour du solde, historique, feedback « Tout est réglé » si plus rien à devoir.

Même esprit : **pas de faux « OK »** sans confirmation prestataire.

---

## 6. Après le paiement joueur — cycle de l’argent

```
1. Joueur paie l’AVANCE chez PayDunya
2. L’argent est chez TerrainSN
3. On calcule et on mémorise :
      - avance reçue
      - commission TerrainSN
      - base / dû gérant
      - mode auto ou retrait
      - fin de la fenêtre de remboursement (si applicable)
4. Pendant la fenêtre (si remboursement autorisé) :
      - dû = « en attente »
      - annulation dans les temps → remboursement joueur, dû annulé
5. Fenêtre terminée (ou pas de remboursement) :
      - dû = « payable »
      - mode AUTO → payout Wave automatique du montant net
      - mode RETRAIT → visible dans le solde gérant, retrait manuel 0 frais
```

**Payouts phase actuelle :** toujours vers le **numéro Wave vérifié** du gérant.  
Orange Money côté payout = hors scope pour l’instant (les numéros restent saisis pour plus tard et pour les tests).

---

## 7. Formules à appliquer (simples, mais strictes)

Tous les montants en **FCFA entiers** (arrondi).  
Snapshot à la confirmation : un changement de contrat plus tard **ne recalcule pas** les anciennes réservations.

```
avance          = arrondi(prix × % avance / 100)
reste_sur_place = prix − avance
commission      = arrondi(avance × % commission / 100)
base_gerant     = avance − commission

Si mode RETRAIT :
    montant_envoyé_gérant = base_gerant
    frais = 0

Si mode AUTO :
    lire qui paie les frais (gérant / plateforme / partage)
    frais_gérant et/ou frais_plateforme selon les % du contrat
    montant_envoyé_gérant = base_gerant − frais_gérant
```

Le super admin a déjà un **aperçu live** (ex. créneau 40 000). Tes calculs doivent donner **exactement les mêmes chiffres** que cet aperçu pour les mêmes paramètres.

---

## 8. Ce que tu dois livrer (checklist fonctionnelle)

### 8.1 Lecture du contrat
- [ ] Pour toute opération d’argent, charger le contrat du **terrain concerné**
- [ ] Aucun %, délai, numéro ou mode inventé dans le code
- [ ] Terrains différents → comportements différents, vérifiés en recette

### 8.2 PayDunya — encaissements (payin)
- [ ] Bouton joueur **Payer** → checkout PayDunya (plus de page « simulation » en production)
- [ ] Lien WhatsApp → même checkout PayDunya
- [ ] Dette gérant **Payer** → checkout PayDunya
- [ ] Montant exact (avance ou dette) ; libellé clair (terrain, réservation / période)
- [ ] Succès / échec / abandon gérés ; confirmation réservation **seulement** après succès

### 8.3 Notifications
- [ ] WhatsApp et push restent **alignés** avec le lien et le statut réel
- [ ] Pas de « c’est confirmé » avant l’argent
- [ ] Lien expiré → message adapté

### 8.4 Fenêtre de remboursement + payout
- [ ] Respect du flag remboursement + délai heures du contrat
- [ ] Annulation dans le délai → remboursement joueur, pas de payout
- [ ] Après délai → dû payable
- [ ] Mode auto → envoi **Wave** du net (commission et frais déduits selon contrat)
- [ ] Mode retrait → accumulation + retrait manuel sans frais
- [ ] Échec payout → visible / alerté (pas silencieux)

### 8.5 Dettes commission
- [ ] Accumulation correcte en sans avance / cas manuels
- [ ] Échéance = fin de mois + délai jours du contrat
- [ ] Paiement gérant via PayDunya met à jour le solde

### 8.6 Production
- [ ] Un terrain « production paiement » n’utilise plus le mock local
- [ ] Sandbox PayDunya acceptable en démo, clairement séparé de la prod

---

## 9. Scénarios de recette (à valider avec Babacar)

### Scénario A — Terrain classique (avance + remboursement 24 h + auto + Wave)
1. Super admin : avance 12,5 %, commission 10 %, Wave gérant vérifié, remboursement 24 h, mode auto, frais gérant.
2. Joueur réserve un créneau 40 000 → avance affichée 5 000 → **Payer** → PayDunya → paie en Wave.
3. Réservation confirmée + WhatsApp/QR.
4. Avant 24 h : annulation → remboursement avance ; gérant ne reçoit rien.
5. Autre réservation : attendre 24 h → payout Wave automatique ≈ base − frais (ex. 4 500 − frais).

### Scénario B — Lien WhatsApp
1. Gérant crée une réservation téléphone sur le même terrain.
2. Joueur reçoit WhatsApp avec lien.
3. Clic → PayDunya → paiement → confirmation identique au parcours app.

### Scénario C — Sans avance
1. Contrat « sans avance », commission 10 %, délai dette 30 j.
2. Joueur confirme **sans** PayDunya.
3. Commission apparaît en dette.
4. Gérant clique **Payer** → PayDunya → solde à jour.

### Scénario D — Deux terrains, deux contrats
1. Terrain A : avance 10 %, commission 8 %.  
2. Terrain B : avance 15 %, commission 12 %.  
3. Même prix créneau → montants PayDunya **différents**. Preuve que le moteur lit bien le contrat.

### Scénario E — Mode retrait
1. Contrat mode retrait, remboursement non autorisé.
2. Joueur paie.
3. Dû visible côté gérant ; **pas** d’envoi auto.
4. Retrait → alerte équipe → virement manuel Wave, 0 frais.

---

## 10. Hors périmètre (pour cette mission)

- Paiement du **reste du match** en ligne (reste = sur place).
- Payouts automatiques vers **Orange Money** (Wave seulement pour l’instant).
- Refonte visuelle complète des écrans (Babacar / design).
- Changement des règles commerciales par le gérant ou le propriétaire (seul le **super admin** signe le contrat).

---

## 11. Collaboration avec Babacar

| Babacar | Mohamed |
|---|---|
| Un seul bouton **Payer** côté joueur (retire Wave/OM de l’UI) | Checkout PayDunya + montants dynamiques |
| Textes, messages, parcours UX | Moteur contrat → calcul → PayDunya → confirmation → dû / payout |
| WhatsApp session / templates côté produit | Lien réel dans le message + sync push |
| Ne casse pas le design / PWA | Ne casse pas les parcours hors paiement |

---

## 12. Définition de « terminé »

La mission est **terminée** quand :

1. Aucun parcours critique (joueur, WhatsApp, dette gérant) ne dépend d’une **page de simulation** pour un terrain en production.  
2. Chaque montant payé ou reversé peut s’expliquer en disant : « c’est écrit dans le contrat de ce terrain ».  
3. Les quatre scénarios A–D (et E si mode retrait utilisé) passent en démo devant l’équipe.  
4. Un payout Wave auto part **après** la fenêtre de remboursement, avec commission et frais corrects.  

---

## 13. Résumé ultra-court pour Mohamed

1. **Lis le contrat du terrain** à chaque paiement.  
2. **Calcule** avance / commission / dû comme l’aperçu super admin.  
3. **Ouvre PayDunya** pour : joueur (avance), WhatsApp (même avance), gérant (dette).  
4. **Attends** la fin du délai de remboursement (si prévu) avant de payer le gérant.  
5. **Payout = Wave** pour l’instant, montant = avance − commission (− frais si mode auto).  
6. **Notifications = même vérité** que le paiement (lien, succès, échec, expiration).  

Tu ne « inventes » pas le métier : tu **rends effectif** le contrat déjà pensé dans le super admin.

---

*TerrainSN · Cahier des charges paiements réels · v1.0 · à l’attention de Mohamed Coulibaly*
