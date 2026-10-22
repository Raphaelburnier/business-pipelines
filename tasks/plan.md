# Plan technique : objectifs À venir durables

## Lot T6 — Fraîcheur et coordination des runs

- Le maître relit les livraisons suivies du projet depuis l'event store à chaque dispatch et transmet aux agents les métadonnées utiles (PR, URL, statut, tête, base, CI et branche). Le worker les présente comme données non fiables, sans charger le code des PR.
- Le worker récupère `origin/HEAD` avant toute étape de code ou revue, compare la tête du run à la branche par défaut et intègre les commits fusionnés au run. Les mises à jour produisent des événements durables indiquant les SHAs observés et intégrés.
- Si le fetch échoue ou si la fusion crée des conflits, l'étape ne démarre pas. Le moteur met le run en `waiting_freshness`, stocke une cause manuelle dans le mécanisme de reprise commun et montre le conflit au cockpit. La reprise retente le contrôle depuis le dernier checkpoint.
- Avant le départ d'un nouveau run, la préparation existante prend déjà `origin/HEAD`; le nouveau contrôle conserve ce comportement et enregistre le SHA de base.
- La livraison conserve le contrôle d'attestation sur l'arbre testé/revu ; le gate GitHub vérifie la CI sur le merge ref courant. Si la branche par défaut avance après le dernier stage, la fusion est bloquée, mais la revue n'est pas relancée automatiquement dans ce lot. Les PR non fusionnées restent de simples métadonnées.

### Ordre de réalisation

1. Contrat événementiel et attente durable `waiting_freshness` dans agent-orchestrator.
2. Synchronisation de la base et contexte PR à chaque dispatch worker.
3. Projection cockpit de l'attente et de la chronologie fraîcheur.
4. Documentation, CI coordonnée des deux dépôts et recette ; le contrôle final avec relance automatique de la revue est reporté.

Les contrats moteur sont livrés avant le cockpit qui les consomme.

## Décisions de conception

- Garder la feuille de route Git comme définition des objectifs ; l’état d’exécution vient
  des commandes et runs de l’event store.
- Porter `objectiveId` et `objectiveRevision` dans la spec de mission, donc dans la charge
  signée et persistante de `run.start`. Ne pas créer une seconde file ni une nouvelle table
  de tâches.
- Réserver un objectif dans la transaction `BEGIN IMMEDIATE` déjà utilisée par
  `src/missions.js`. La recherche d’une attribution active et l’insertion de la commande
  restent atomiques ; `requestId` conserve son idempotence actuelle.
- Le moteur reste propriétaire des états d’exécution. Le cockpit lit l’attribution en
  reliant les commandes `run.start` à leur run et à leur livraison, puis affiche cette
  projection dans « À venir ».
- Ajouter un petit manifeste partagé des identifiants/révisions admissibles, consommé côté
  API et côté web. Il sert à rejeter les identifiants inconnus ou retirés ; les titres et
  détails restent définis dans `web/src/avenir/feuille.ts`. Un test vérifie la cohérence des
  deux sources.
- Garder l’ordonnanceur existant : plusieurs objectifs distincts peuvent attendre dans la
  file actuelle. La reprise de quota réutilise le run courant et sa politique existante.

## Dépendances et ordre de réalisation

```text
Contrat et catalogue partagé
          ↓
Réservation idempotente + lecture d’état API
          ↓
Formulaire « À venir » et affichage des attributions
          ↓
Recette intégrée, documentation et livraison
```

Les étapes sont séquentielles : le front doit consommer le contrat API stabilisé avant
d’être raccordé. Les changements au moteur sont limités à la validation du contrat si le
schéma strict actuel l’exige ; le cockpit conserve l’écriture via la commande signée
`run.start`.

## Étapes

### 1. Contrat de référence des objectifs

- Ajouter un manifeste partagé avec les IDs admissibles et une révision explicite de leur
  définition.
- Ajouter `objectiveId` et `objectiveRevision` aux types de mission côté cockpit et à la
  charge métier transmise dans la spec. Inclure ces valeurs dans l’empreinte/idempotence.
- Rendre l’action indisponible pour un objectif fait ou absent du manifeste.
- Vérifier côté serveur que l’ID et la révision correspondent au manifeste ; ne pas faire
  confiance au navigateur.

**Vérification :** tests de schéma et test de cohérence manifeste ↔ feuille de route, avec
cas inconnu, retiré et révision périmée.

### 2. Réservation durable et lecture API

- Dans `src/missions.js`, conserver `BEGIN IMMEDIATE`, rechercher toute commande ou tout
  run actif portant le même `objectiveId`, puis créer la commande `run.start` avec cette
  référence dans la même transaction.
- Une répétition du même `requestId` et de la même empreinte retourne la commande existante.
  Une autre demande pour un objectif déjà actif reçoit un conflit sans créer de commande.
- Autoriser une nouvelle attribution après un état terminal (`failed` ou `cancelled`) ; ne
  pas libérer un objectif à `waiting_quota`, `waiting_machine`, `waiting_approval` ou pendant
  une revue.
- Exposer une lecture paginée ou limitée des attributions récentes par objectif. Elle
  dérive le statut des champs existants (`commands`, `runs`, événements et `deliveries`) et
  ne modifie jamais l’event store.
- Corréler la commande au `runId` avec le mécanisme actuel. Si le runner n’a pas encore créé
  le run, garder l’état en file grâce au statut de commande.

**Vérification :** tests d’idempotence, de deux requêtes concurrentes, de conflit, de
réattribution après terminal et de lecture après recréation de la connexion SQLite.

### 3. Parcours cockpit dans « À venir »

- Ajouter une action d’attribution aux objectifs admissibles et un formulaire prérempli
  avec le titre et le détail.
- Demander le projet, l’agent compatible (Codex ou Claude) et des critères de réussite
  modifiables. S’appuyer sur les listes de projets, agents et modèles déjà servies par le
  cockpit.
- Réutiliser le contrat existant de lancement de mission et le modèle de sélection de
  l’équipe ; ne pas créer une seconde voie d’exécution.
- Afficher pour chaque objectif attribué son projet, son agent, son run et son état. Bloquer
  les doubles lancements en UI, tout en laissant le serveur garantir l’exclusivité.
- Actualiser la vue avec le mécanisme de rafraîchissement déjà utilisé par le cockpit et
  restaurer le même état après rechargement.

**Vérification :** tests de formulaire, états actifs/terminaux, erreur de conflit et
rechargement avec attribution déjà existante.

### 4. Recette complète et livraison

- Tester deux objectifs différents en attente et un objectif commun soumis depuis deux
  sessions.
- Simuler une attente quota avec échéance connue : la reprise garde le même `runId` et
  l’attribution. Avec échéance inconnue, garder l’objectif réservé et proposer la reprise
  manuelle existante.
- Vérifier les statuts de livraison séparément du statut d’exécution ; conserver les gates
  de CI, revue et fusion actuels.
- Valider chaque dépôt avec ses commandes CI réelles, puis livrer le moteur avant le cockpit
  si le contrat du moteur a changé.
- Mettre à jour `docs/MISSIONS.md`, `docs/QUOTAS-REPRISES.md` et la fiche d’état du vault à
  partir des résultats réellement vérifiés.

**Vérification :** parcours persistant objectif → commande → run → attente/reprise → résultat
et livraison, sans doublon après redémarrage.

## Risques et réponses

| Risque | Réponse prévue |
|---|---|
| La feuille de route et le manifeste divergent | Test de cohérence obligatoire ; échec fermé pour un ID non déclaré. |
| Deux sessions réservent en même temps | Vérification et création sous le même verrou d’écriture SQLite. |
| Un run attend longtemps ou le worker est éteint | L’attribution reste active ; elle suit les états d’attente existants. |
| Un run réussit mais sa PR n’est pas fusionnée | Montrer l’état du run et celui de la livraison séparément. |
| Le reset de quota est inconnu | Ne pas inventer d’échéance ni relancer en boucle ; laisser l’action manuelle existante. |
| Le contrat de mission est strict entre dépôts | Faire évoluer et valider le contrat moteur avant d’activer le front. |

## Hors périmètre de l’extension

Pas de récurrence calendrier, de sélection automatique d’agent, de collaboration multi-agent
sur un même objectif, ni de fusion automatique sensible. La planification des tâches et
l’ordonnancement avec priorités font désormais partie de l’extension décrite ci-dessous.

## Extension planifiée : tâches prioritaires et reprise après quota

Cette extension ajoute la planification explicite des objectifs, leur priorité, leur ordre
FIFO stable, et la priorité des reprises quota arrivées à échéance. Elle ne modifie pas la
feuille de route Git pour lancer un objectif. Le contrat fonctionnel et les limites
existantes sont dans `docs/SPEC-objectifs-durables.md`, section « Extension : planification
et priorité des tâches ».

### Contrat technique vérifié

- Les `run.start` sont persistés comme commandes `pending`; le sélecteur actuel est FIFO
  (`created_at, rowid`) parmi les commandes admissibles.
- Le moteur crée les reprises `run.resume` de manière durable quand un quota a une échéance
  fournisseur fiable. La reprise garde le même `runId` et reste bornée par le nombre de
  tentatives, le plafond par compte et la durée maximale d’attente.
- La priorité est reconnue dans `payload_json.scheduling.priority` de `run.start`, sans colonne
  ni migration ;
  l’absence du champ dans l’historique vaut `normale`. `run.resume` hérite de la priorité via
  le `run.start` relié au même `runId`.
- L’API cockpit ne doit pas écrire directement dans l’event store. La reclassification passe
  par une API EventStore transactionnelle. Le sélecteur cible doit respecter les reprises
  automatiques dues, les contrôles FIFO, puis les départs prioritaires.

### Décision retenue et points à spécifier avant l’implémentation

1. Décision : option A, priorité mutable reconnue dans `payload_json.scheduling.priority` de
   `run.start`, exclue
   de la mission figée et de `requestHash`; aucun champ SQL, migration, commande
   `run.reprioritize` ni table parallèle. L’historique sans priorité vaut `normale`.
2. L’API EventStore reclassifie ce champ dans une transaction et refuse une réservation active
   ou une tâche terminale.
   Une création idempotente existante ne réinitialise pas sa priorité.
3. L’ordre cible est : reprises automatiques quota fiables et dues (même `runId`, FIFO stable),
   contrôles `approval.decide`, `run.reverify` et reprises
   manuelles en FIFO relatif, puis `run.start` par priorité haute/normale/basse et FIFO stable.
   Seules les commandes admissibles non terminales sont sélectionnées ; aucune préemption.
4. `chat.respond`, maître distant, publieur et livreur restent hors de l’ordonnanceur des runs.
   La priorité est sémantique et indépendante de HMAC. La dépendance liée dans ce worktree est
   ancienne et ne persiste pas les signatures, mais le moteur cible `engine-task-priorities`
   (`origin/master`) accepte `signer`/`sig` et sa CI inclut un test de persistance ; vérifier
   le SHA et le run CI de la version effectivement livrée.
5. Une ligne Git `en-cours` sans attribution n’est pas rattachée implicitement ; toute
   création ou association exige une action explicite et un `runId` vérifié.
6. Les contrôles de dépendance, runtime/machine, authentification et fraîcheur restent ceux du
   flux existant avant création/lancement. Les attentes machine, auth, fraîcheur inconnue ou
   périmée, dépendance ouverte et quota sans reset fiable restent bloquées.

### Ordre de réalisation proposé

```text
Contrat moteur et décision d’ordonnancement
                 ↓
Priorité persistée + sélection reprise quota avant nouveau run
                 ↓
Lecture de file et états de planification pour le cockpit
                 ↓
Actions cockpit : créer, prioriser, rattacher ou annuler une tâche admissible
                 ↓
Recette FIFO/priorités, reprise quota, redémarrage et garde-fous
```

#### Q1 — Contrat moteur et admissibilité

- Implémenter le contrat retenu : priorité reconnue dans
  `payload_json.scheduling.priority`, mise à jour via API EventStore transactionnelle avant
  réservation, hors mission et `requestHash`.
- Sélectionner d’abord les reprises quota fiables et dues, puis les contrôles FIFO relatifs,
  puis les `run.start` admissibles par priorité et FIFO stable.
- Garder l’ordre FIFO fondé sur `created_at, rowid` stable après reclassification.
- Vérifier les chemins qui consomment la file, les limites de reprise quota, les statuts
  machine/authentification/approbation et les contrôles de fraîcheur.
- Vérifier que `run.resume` retrouve la priorité par la liaison durable `runId` → `run.start`.
- Vérifier la version moteur réellement utilisée : la cible `engine-task-priorities` accepte
  `signer` et persiste `sig`, tandis que l’ancien lien de dépendance du worktree cockpit ne
  les prend pas en charge. La priorité reste indépendante de HMAC ; ne pas ajouter de kind.
- Confirmer qu’une tâche Git `en-cours` sans attribution reste non associée jusqu’à une action
  explicite et une vérification du `runId`.

**Vérification :** contrat et schémas moteur relus ; priorité modifiable sans changer
`requestHash`; reprise liée au run source; consommateurs identifiés; workflow CI cible couvrant
la persistance HMAC, avec SHA et résultat du run CI de livraison vérifiés.

#### Q2 — Ordonnanceur persistant

- Persister la priorité dans `payload_json.scheduling.priority` de `run.start` via l’API
  EventStore ; garder l’event store moteur comme source canonique, sans colonne ni table
  supplémentaire.
- Faire passer les reprises quota automatiques fiables et dues avant les contrôles FIFO, puis
  les nouveaux `run.start` ordonnés par priorité et FIFO stable.
- Laisser les tâches non admissibles en attente sans bloquer les tâches suivantes qui le sont.
- Conserver le run courant pour chaque reprise ; ne pas préempter les runs actifs.
- Revalider machine, runtime, authentification, fraîcheur et dépendances au moment de réserver
  une nouvelle tâche.

**Vérification :** tests d’ordre priorité/FIFO et de non-préemption ; test de reprise même
runId ; tests d’attente quota inconnu, auth, machine indisponible, freshness périmée et
dépendance bloquée.

#### Q3 — File dans le cockpit

- Afficher les tâches et leur état d’exécution distinct du statut Git et du statut de
  livraison.
- Permettre de choisir/modifier la priorité et d’afficher l’ordre effectif de passage.
- Ne pas associer automatiquement `en-cours` à un run ni créer d’attachement implicite ; toute
  création ou association requiert une action explicite et la vérification du run.
- Ne proposer que les actions autorisées par l’état réel ; ne pas exposer une annulation de
  run actif tant que le moteur n’a pas de commande vérifiée pour cela.

**Vérification :** tests d’états et actions disponibles, lecture persistante après
rafraîchissement/redémarrage, refus d’une tâche inadmissible.

#### Q4 — Recette intégrée

- Prouver que plusieurs tâches utilisent priorité puis FIFO stable.
- Prouver qu’une reprise quota échue passe avant un nouveau départ et conserve le même run.
- Prouver qu’un reset inconnu, une auth manquante, une machine absente, une fraîcheur
  invalide ou une dépendance ouverte ne déclenche pas de run dangereux.
- Prouver qu’une priorité supérieure ne préempte pas une tâche `running`.
- Mettre à jour la documentation et la fiche projet avec les preuves obtenues.

**Vérification :** commandes CI réelles de chaque dépôt modifié puis recette cockpit
persistante, incluant redémarrage et séparation des états run/livraison.
