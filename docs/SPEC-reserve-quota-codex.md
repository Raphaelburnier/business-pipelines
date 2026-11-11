# Réserve de quota Codex — extension du lot 2.9

**Résumé — proposition du 11 novembre 2026, à valider avant implémentation.** Ajouter une réserve Codex indépendante de Claude, désactivée et sans seuil initial. L’opérateur choisit un pourcentage consommé de la fenêtre courte Codex. Au seuil ou sans mesure récente, les nouveaux appels Codex attendent ; les étapes en cours terminent, sans perte du run ni consommation d’une tentative de reprise pour quota réel. Prochaine étape : validation de ce périmètre et du contrat ci-dessous.

## Objectif et comportement proposé

Conserver du quota de l’abonnement Codex pour l’usage interactif, avec le même fonctionnement que la réserve Claude déjà livrée. Chaque fournisseur conserve son propre réglage : changer Codex ne modifie ni le seuil, ni l’activation, ni l’historique de Claude.

- Codex commence avec `{ active: false, seuilUtilise: null }`. Champ vide ; aucun pourcentage implicite.
- Le seuil est un entier de 1 à 100, exprimé en **pourcentage déjà consommé du compte**, sessions interactives comprises. Activer sans seuil est refusé.
- La mesure retenue est la fenêtre courte exposée par le collecteur actuel sous `primary`, dans `runtime.quota_snapshot` de runtime `codex`. La fenêtre `secondary` ne la remplace pas et ne reçoit pas de seuil configurable dans cette extension. Les contrôles de véritable quota restent applicables aux deux fenêtres.
- Si la réserve est active, une consommation supérieure ou égale au seuil retient les nouveaux appels Codex. Une mesure absente, incorrecte, vieille de plus de quinze minutes ou dont le reset est passé produit l’état explicite « mesure inconnue » et retient également ces appels.
- Une réserve désactivée ne bloque pas à elle seule. Les autres contrôles existants, dont pause, annulation, maintenance, disponibilité et véritable quota fournisseur, continuent de s’appliquer.

Une étape déjà envoyée termine normalement. La réserve s’applique avant le prochain appel local ou envoi au worker, y compris après une attente de capacité, et sur les départs planifiés et reprises. Un contrat de run déjà figé ne change ni de fournisseur ni de modèle à cause de la réserve. Les autres runs et branches en cours suivent leur fournisseur et sa propre réserve, sans annulation par cette attente.

Le run attend sous `waiting_quota` avec le motif distinct `reserve-interactive`. Son identifiant, sa session Codex, son workspace, ses résultats et checkpoints sont conservés. Cette attente ne déclenche ni relais de fournisseur, ni escalade de modèle, ni échec métier. Les reprises de réserve ne consomment pas les tentatives de véritable quota et ne remettent jamais leurs compteurs à zéro. Un quota réel Codex reste contrôlé **avant** la réservation et le comptage de sa reprise, comme la correction livrée pour Claude.

Une nouvelle mesure fraîche sous le seuil permet la reprise au prochain contrôle, sous réserve des autres conditions. Le reset seul n’autorise pas le lancement. Dans une même fenêtre identifiée par son reset, conserver le maximum valide déjà observé, y compris après redémarrage ou réenregistrement du même réglage ; une baisse isolée ne prouve pas une nouvelle fenêtre. Un vrai changement de réglage suit la sémantique Claude existante. Aucune durée arbitraire n’est déduite du nom `primary` pour rechercher cet historique.

## Interface proposée

Ajouter « Réserve Codex » à côté de « Réserve Claude », avec un formulaire identique : activation, seuil initialement vide, état appliqué et modification en attente. Nommer explicitement Codex et sa fenêtre courte ; montrer la consommation et le reset disponibles pour interpréter le seuil. Lecture et commande restent accessibles au clavier et sur écran de 375 px.

Les messages d’attente de run citent le fournisseur concerné. Une erreur de lecture ou d’acquittement Codex ne doit pas afficher un réglage Claude ni annoncer une modification déjà appliquée. Un lecteur sans droit opérateur conserve l’accès à l’état sans droit d’écriture.

## Extension du contrat entre cockpit et moteur

### Route Codex

Ajouter `GET /api/quota/reserve-codex` et `POST /api/quota/reserve-codex`. Le GET utilise la même forme de réponse que la route Claude : `configuration`, `etat`, `mesure`, `attenteJusqua`, `autorise`, `modificationEnCours`. Le runtime est déterminé par la route ; aucune valeur du corps ne peut le remplacer.

Le POST accepte strictement la configuration existante :

```json
{ "active": true, "seuilUtilise": 75 }
```

`75` est un exemple, jamais une valeur initiale. Le seuil est nullable uniquement si la réserve est désactivée. La réponse reste `202` avec `id` et `statut`. L’identité opérateur, l’origine et la signature HMAC suivent le chemin d’autorité actuel, car ce réglage autorise ou retient des exécutions.

### Commande et événement durables

Conserver `quota.reserve.set`. Étendre son schéma par un champ optionnel `runtime`, limité à `claude` ou `codex`. Une ancienne commande sans ce champ continue de viser Claude. Pour la route Codex, le serveur construit puis signe :

```json
{ "runtime": "codex", "active": true, "seuilUtilise": 75 }
```

Le runtime fait partie du corps signé. Une normalisation ne doit pas ajouter ce champ avant vérification à une ancienne commande signée sans lui. La route Claude, ses réponses et ses configurations déjà enregistrées restent compatibles.

L’événement existant `quota.reserve_changed` reçoit `runtime: "codex"` pour un réglage Codex, avec les champs actuels `active`, `seuilUtilise`, `par`, `canal`, `commandeId`. Un événement historique sans runtime signifie Claude. La sélection du dernier réglage, des commandes en attente et des maximums observés est séparée par fournisseur. Application, déduplication durable par commande et acquittement restent atomiques dans la voie courte du publieur, indépendante de la file des runs.

### Attente et rejet distant

Réutiliser `ReserveQuotaBloquee` et `detail.rejet.reserve`. Ajouter au détail de réserve le champ optionnel `runtime: "codex"` pour Codex ; son absence reste compatible avec les anciens rejets Claude. Les champs actuels du détail restent inchangés. Dans la cause durable d’attente, renseigner `runtime: "codex"` et `motif: "reserve-interactive"` ; le transport existant conserve ces informations sans les transformer en perte d’étape.

Aucune nouvelle table, clé de production, variable de déploiement ni type WebSocket de worker n’est proposé. La collecte Codex existe déjà : sonde indépendante des runs dans le runner et le worker. Elle doit continuer pendant l’attente de réserve pour permettre sa levée.

## Sources et zones concernées

Inspection : cockpit `04989fe2ebaad8cb55afb5f7b8ec1c3ff80d4842`, moteur `e50e3cfa9446c33d929729fe55f171699986c5c5`.

- Moteur : `src/quota-reserve.js`, `src/run-waits.js`, contrôles d’exécution locale et distante, `packages/schemas/quota-reserve.js`, `packages/schemas/commandes.js`, schémas cockpit et tests Vitest.
- Cockpit : `src/reserve-quota.js`, planificateur et file, `bin/cockpit.js`, `src/signature-commandes.js`, interface de réserve et adaptateurs de données.
- Sources de mesures existantes : `AO src/codex-quota.js`, `src/quota-snapshots.js`, `src/worker.js`, `BP bin/commande-runner.js`.
- Référence fonctionnelle : `docs/SPEC-reserve-quota-claude.md`. Son contrat reste celui de Claude ; ce document décrit uniquement son extension à Codex.

Conserver CommonJS serveur/moteur, TypeScript React et les schémas Zod partagés du moteur. La décision de réserve reste commune aux consommateurs, avec une horloge injectable, afin que file, planificateur et exécution ne divergent pas. Exemple de décision attendue : `utilisation >= configuration.seuilUtilise` ; une absence de mesure n’équivaut jamais à zéro.

## Critères d’acceptation et validation

1. Sans réglage Codex, aucune nouvelle contrainte : réserve désactivée, seuil null, champ vide. Les anciens événements et commandes Claude restent lisibles et vérifiables.
2. Activer sans seuil, fraction, chaîne, valeur hors bornes, runtime non prévu ou champ inconnu est refusé selon le schéma concerné.
3. À un seuil choisi de 75 : 74,9 autorise ; 75 et au-delà retiennent Codex. Claude reste soumis à son seul réglage, et réciproquement. Les deux réserves peuvent être actives simultanément avec des seuils différents.
4. Mesure manquante, périmée, invalide, reset passé et absence de `primary` : attente explicite si active ; `secondary` ne sert pas de substitution.
5. Une ancienne mesure d’un autre fournisseur ou une baisse dans la même fenêtre ne lève pas la réserve. Une nouvelle fenêtre fraîche, un relèvement de seuil ou une désactivation sont réévalués correctement après redémarrage.
6. Un appel déjà en cours finit ; le suivant est retenu avant envoi. Reprise du même run et de la même session ; aucun relais ou modèle plus fort déclenché par la réserve.
7. Reprise de vrai quota Codex retenue avant création de commande et incrémentation, y compris demande directe, redémarrage et commande déjà réservée : pas de nouvelle tentative consommée ni de compteur effacé.
8. Réglages Claude et Codex simultanément en file : état en attente et acquittement attribués au bon fournisseur. Rejeu et crash n’appliquent pas deux fois une même commande.
9. HMAC altéré, utilisateur non autorisé et corps tentant de remplacer le fournisseur de la route : refus explicite. Une ancienne signature Claude garde son contenu original.
10. Interface clavier et mobile, états appliqué/en attente/erreur, mesures et noms de fournisseur cohérents. Sonde de quota encore active lorsque les appels sont retenus.

Tests déterministes sur SQLite temporaire, horloge et fournisseurs simulés ; suites existantes et vérification navigateur. Aucun modèle payant ni modification des réglages de production pour ces tests.

Dans deux dossiers frères `agent-orchestrator` et `business-pipelines`, installer les dépendances avec `npm ci` dans chacun, puis `npm --prefix web ci` depuis le cockpit. Commandes existantes :

```sh
# Depuis agent-orchestrator : tests et types
npm test

# Depuis business-pipelines
node --test test/quota.test.js test/reprises-runs.test.js test/planificateur.test.js test/atelier.test.js test/controle-execution.test.js test/api-controle-execution.test.js
npm run web:test
npm --prefix web run build
npm test
```

## Périmètre de validation humaine

Le point fonctionnel à confirmer est le choix de la fenêtre courte Codex, indépendamment de Claude, sans seuil hebdomadaire configurable dans cette extension. Les schémas de commande, d’événement et de rejet ci-dessus sont proposés pour cette extension, pas déjà validés.

Source : règle « Conception » du `AGENTS.md` commun, « proposer un schéma et attendre la validation ». Elle s’applique ici parce qu’un réglage auparavant exclusivement Claude reçoit désormais une cible fournisseur ; expliciter cette cible empêche qu’une commande Codex modifie Claude. Le skill `spec-driven-development` demande de terminer la phase de spécification par une validation avant planification ou code. Les règles de fusion et de livraison existantes restent distinctes de cette validation fonctionnelle.
