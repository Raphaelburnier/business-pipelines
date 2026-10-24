# Spec : objectifs « À venir » attribuables et reprenables

## Objectif

Depuis la page « À venir », Raphaël peut transformer une ligne de feuille de route en
travail durable, choisir le projet et l’agent (Codex ou Claude), puis laisser le cockpit
exécuter et suivre ce travail sans qu’une autre session prenne le même objectif.
Si le quota bloque le run, le travail reprend depuis le même run lorsque l’échéance est
connue et que le worker est disponible.

La source de la liste reste le fichier web/src/avenir/feuille.ts. Le statut d’attribution
sera superposé à cette liste, sans modifier le statut Git de la feuille au lancement.

## Périmètre MVP

- Un objectif attribué à un seul agent et à un seul run à la fois.
- Le formulaire demande un projet, un agent compatible, une consigne et des critères de
  réussite. Le choix de modèle suit le sélecteur existant des missions.
- Une réservation atomique empêche deux sessions de démarrer le même objectif.
- Un objectif déjà pris affiche son agent, son run et son état ; il n’est pas réattribuable
  tant que le travail est actif ou en attente.
- La tâche est liée au runId créé par le mécanisme existant de missions.
- waiting_quota conserve la tâche et le run. La reprise automatique utilise le mécanisme
  du moteur : échéance fournisseur fiable, ou délai de prudence borné si elle manque
  (lot 2.8, [spécification](SPEC-reprise-quota.md)). Aucun reset n'est inventé.
- Les objectifs différents peuvent être attribués à des agents différents ; l’ordonnanceur
  respecte la capacité disponible du worker.

## Hors périmètre du MVP

Ces exclusions cadrent le MVP initial d’attribution. L’extension « planification et
priorité des tâches » plus bas élargit explicitement le périmètre pour planifier le travail.

- Choisir automatiquement l’agent optimal, créer des équipes ou faire collaborer plusieurs
  agents sur le même objectif.
- Inventer une date de reset quand le fournisseur ne la donne pas.
- Modifier la définition ou le statut versionné d’un objectif dans Git depuis l’interface.
- Fusionner une PR sensible ou contourner les règles de revue et de fusion existantes.
- Dépendre des tâches planifiées propres à Codex ou Claude : le cockpit reste le planificateur
  commun.

## Architecture existante à respecter

- La page À venir est actuellement une liste statique avec des identifiants d’étapes stables.
- Le cockpit prépare une mission via POST /api/runs et dépose des commandes signées ; il ne
  modifie pas directement l’event store.
- L’orchestrateur est la source canonique des commandes, runs et événements persistants.
- Une mission existante a un requestId idempotent, mais il ne garantit pas l’exclusivité
  entre deux demandes différentes liées au même objectif de la feuille.
- La reprise après quota utilise le même run et sa charge immuable. Le lot 2.8 ajoute
  une tentative bornée après un délai de prudence pour les attentes sans date fiable.

## Contrat fonctionnel

Une attribution référence au minimum :

- l’identifiant stable de l’objectif, son libellé et la révision de sa définition ;
- le projet choisi, l’agent choisi, sa configuration de modèle et les critères de réussite ;
- un identifiant de demande idempotent ;
- le runId associé, l’état d’attribution et les horodatages ;
- le dernier motif d’attente ou d’échec, sans stocker de credential.

États visibles : queued, running, waiting_quota, waiting_machine, waiting_approval,
review, completed, failed, cancelled. Une attribution annulée ou échouée peut être
relancée ; une attribution active ne peut pas être dupliquée. La complétion reflète le
résultat vérifié et le statut de livraison du run, pas seulement la fin d’un appel modèle.

## Stack et commandes

- Cockpit : React, TypeScript, Vite ; API Node.js et event store SQLite.
- Moteur : agent-orchestrator, commandes signées, runner durable et workers.
- Commandes de validation existantes :
  - npm test
  - npm run web:test
  - npm run web:build

## Style et structure

- Garder le rendu de la feuille dans web/src/avenir/ et les types partagés validés par
  l’API dans packages/schemas/.
- Le navigateur demande une attribution au cockpit ; seul l’orchestrateur écrit l’état
  canonique et confirme la réservation.
- Valider les entrées côté serveur : objectif connu, statut admissible, projet et agent
  compatibles, critères bornés, identifiant de demande valide.
- Réutiliser les composants et le contrat du formulaire de mission au lieu de dupliquer
  une seconde implémentation de lancement.

## Stratégie de validation

- Tests unitaires : attribution concurrente, idempotence, refus d’un objectif déjà réservé,
  libération après annulation et liaison exacte entre objectif et run.
- Tests d’intégration : mission attribuée → quota connu → reprise du même runId sans
  nouvelle attribution ; échéance inconnue → tentative bornée sans date fournisseur inventée.
- Tests cockpit : états de l’objectif, projet/agent/run affichés, actions admissibles selon
  le statut.
- CI de chaque dépôt sur le SHA exact ; recette de fusion et livraison selon la politique
  existante des chemins sensibles.

## Limites et règles

- Toujours vérifier la compatibilité projet/agent au serveur et réserver atomiquement.
- Toujours garder l’identifiant d’objectif dans les événements et le suivi du run.
- Demander validation humaine lorsqu’une action ou un fichier relève des règles sensibles
  existantes.
- Ne jamais démarrer deux runs pour la même attribution après une répétition HTTP, un
  redémarrage du runner ou une reprise de quota.
- Ne jamais appeler un fournisseur en boucle pour détecter un reset inconnu.

## Critères de réussite

1. Depuis À venir, un utilisateur lance un objectif admissible avec le projet, l’agent et
   les critères demandés.
2. Deux demandes concurrentes sur le même objectif n’obtiennent qu’une attribution et un
   run.
3. L’interface montre l’agent, le projet, le run et l’état durable après rechargement et
   redémarrage des services.
4. Après waiting_quota, la reprise garde le même objectif et le même runId ; aucun
   doublon n’est créé.
5. Une échéance inconnue programme une tentative de prudence bornée, sans inventer de reset fournisseur.
6. Les fusions et livraisons continuent d’appliquer leurs contrôles habituels.

## Décision UX validée

- Le formulaire préremplit le titre et le détail depuis « À venir ».
- L’utilisateur choisit le projet et l’agent, puis peut ajuster les critères de réussite
  avant le lancement.

## Extension : planification et priorité des tâches

Cette extension transforme les attributions du cockpit en tâches planifiables. Elle ne
change ni le statut Git de la feuille de route, ni le contrat de reprise d’un run déjà
persisté.

### Source et cycle de vie

- Une tâche planifiée est créée explicitement dans le cockpit et possède une priorité,
  un ordre de création stable, ses paramètres d’exécution et, après lancement, le `runId`
  qu’elle suit. La feuille de route reste la définition des objectifs ; son statut n’est
  pas une commande d’exécution.
- Les états de planification sont `queued`, `running`, `waiting_quota`, `waiting_machine`,
  `waiting_auth`, `waiting_approval`, `waiting_freshness`, `blocked_dependency`, `review`,
  `completed`, `failed` et `cancelled`. Les états d’attente reflètent les données canoniques
  du run lorsque celui-ci existe. `waiting_freshness` et `blocked_dependency` sont des états
  de planification à définir avec l’API retenue ; le moteur ne déclare pas aujourd’hui un
  statut de run `waiting_freshness`.
- Une tâche en cours d’exécution conserve son run et sa place logique. Elle n’est ni
  réinsérée comme nouveau départ, ni interrompue lorsque la priorité d’une autre tâche
  change.
- Une ligne de feuille de route déjà `en-cours` n’est pas importée ni associée implicitement
  à une tâche ou un run. Le statut Git ne fournit pas de `runId` ; toute création ou association
  à cette ligne exige une action explicite de l’utilisateur.
- Une tâche dont les dépendances ne sont pas toutes `completed` reste `blocked_dependency`.
  Une dépendance échouée ou annulée requiert une décision humaine avant tout lancement du
  successeur.

### Priorité et ordre de passage

- Chaque nouveau `run.start` reçoit une priorité `haute`, `normale` ou `basse` dans
  `payload_json.scheduling.priority`. Une commande historique sans ce champ a la priorité
  `normale` ; aucune
  migration de colonne ou de table n’est nécessaire. Une modification de priorité ne change
  ni la date de création ni le `requestHash` de la mission.
- La sélection suit cet ordre strict et ne réserve que des commandes admissibles, encore
  non terminales :
  1. `run.resume` automatique de quota dont la date fournisseur ou le délai de prudence est arrivé à
     échéance, en reprenant le même `runId` et en conservant le FIFO stable.
  2. Les commandes de contrôle `approval.decide`, `run.reverify` et les reprises manuelles
     (`run.resume`) en FIFO stable entre elles, sans réordonner leur ordre relatif.
  3. Les nouveaux `run.start` admissibles par priorité haute, normale, basse, puis FIFO
     stable (`created_at`, `rowid`). Une commande bloquée ou périmée est ignorée et ne retarde
     pas une commande admissible.
- `run.resume` ne duplique pas la priorité : il l’hérite depuis le `run.start` lié au même
  `runId`. La reprise ne crée pas un nouveau run.
- Une attente quota reste sur le même run. Elle ne reprend pas avant son reset fiable
  ou, sans date fournisseur, avant le délai de prudence de cinq heures défini au lot 2.8.
- Un run `running` n’entre pas dans le tri des tâches à lancer. Il continue jusqu’à son
  propre état terminal ou d’attente ; aucune préemption ni interruption implicite n’est
  autorisée.

### Conditions d’admissibilité et arrêts sûrs

- Avant la création d’une tâche et au lancement, conserver les validations du flux existant :
  projet et mission compatibles, dépendances satisfaites, runtime et machine disponibles,
  authentification valide, et fraîcheur requise par le pipeline. Si un contrôle échoue ou
  n’a pas de preuve fraîche, la tâche reste bloquée ou le lancement est refusé ; elle n’est
  pas réservée comme commande exécutable.
- Un `run.resume` automatique est admissible uniquement pour une attente `waiting_quota`
  dont la date de reprise bornée est échue et toujours associée au même run. L’authentification
  expirée demande une reconnexion explicite ; une attente `waiting_auth` n’est jamais reprise
  automatiquement.
- Une machine indisponible, une vérification de fraîcheur périmée ou inconnue, une dépendance
  non satisfaite et un quota dont le délai n'est pas écoulé restent bloqués. La planification
  ne réveille pas de machine et n'invente aucune date fournisseur.
- Les limites du moteur sur les reprises quota (fenêtre maximale et plafonds par run et
  compte) continuent de s'appliquer. Une borne atteinte requiert la reprise manuelle.
- Une tâche lancée n’est pas préemptée pour laisser passer une priorité supérieure. L’arrêt
  ou l’annulation d’un run actif n’est possible que via une commande moteur explicite ; le
  schéma courant ne déclare pas `run.cancel`.

### Décision d’interface moteur

#### Options évaluées

| Option | Fonctionnement | Coût et risque |
|---|---|---|
| A — priorité sur `run.start`, héritée par `run.resume` | Persister la priorité reconnue dans le `payload_json` du `run.start` existant. L’ordonnanceur retrouve cette priorité depuis la commande `run.start` liée au `runId` ; `run.resume` ne la duplique pas. | Une sélection ordonnée et une API EventStore de reclassification transactionnelle. Pas de colonne ni table parallèle ; le `requestHash` de mission reste inchangé car la priorité est exclue de la mission figée. |
| B — commande signée `run.reprioritize` | Créer une commande ciblant un `run.start` encore pending et en changer le rang. | Nouveau type, schéma et consommateur, clé disponible au runner, clé d’idempotence et transaction qui vérifie que la cible est encore pending avant mise à jour. Le HMAC actuel expire après 30 minutes. Avec le FIFO actuel, le `run.start` plus ancien serait pris avant la commande de repriorisation ; il faudrait quand même changer le sélecteur. |

#### Décision retenue : option A

La priorité est le champ reconnu `payload_json.scheduling.priority` de la commande `run.start`,
indépendant de la mission figée, de son identifiant de demande et de `requestHash`. Une commande historique
sans ce champ vaut `normale`. Elle est modifiable par le cockpit tant qu’elle n’est ni réservée
ni terminale ; un run actuellement `running` ne peut pas être reclassé et n’est jamais préempté.
La reclassification passe par une API EventStore et s’effectue dans une
transaction ; elle refuse une réservation active et les tâches terminales. Une répétition
idempotente de la création retourne la commande existante sans réinitialiser sa priorité. Aucun
changement de colonne ou migration de table n’est requis.

La priorité du run se retrouve via son `run.start` source, lié au `runId`. `run.resume` garde
son payload, son `waitId` et ses règles d’idempotence actuels ; l’ordonnanceur consulte la
priorité du `run.start` lié au lieu de créer une nouvelle demande. La sélection applique cet
ordre strict : reprises automatiques `run.resume` de quota dues et bornées, en conservant le
même `runId` et le FIFO stable ; commandes de contrôle
`approval.decide`, `run.reverify` et reprises manuelles dans leur FIFO relatif ; nouveaux
`run.start` admissibles par priorité haute, normale, basse puis FIFO stable (`created_at`,
`rowid`). Seules les commandes admissibles et non terminales sont sélectionnées ; une commande
bloquée ne retarde pas les suivantes admissibles. Un run en cours ne peut pas être préempté.

Cette métadonnée ne constitue pas une autorisation à exécuter une tâche et ne change aucun
champ de mission. Elle reste modifiable par l’API cockpit authentifiée, comme la demande
`run.start` actuelle : l’identité et le droit d’écriture sont vérifiés avant le routage API
dans `bin/cockpit.js`. Elle n’est pas une commande d’autorité HMAC : l’option B élargirait la
liste des kinds signés et imposerait que le runner vérifie ces signatures. La repriorisation
reste donc une modification authentifiée du champ de planification, pas une nouvelle commande
signée ; ne pas étendre le contrat HMAC pour ce MVP.

#### État HMAC observé et limite de version

`src/signature-commandes.js` réserve le calcul HMAC aux kinds d’autorité ; `run.start` n’est
pas signé par ce mécanisme. Dans ce worktree cockpit, `file:../agent-orchestrator` résout
vers une ancienne version (`worker-document-capabilities-20261015`) qui ne déclare pas
`signer` à `creerCommande` et ne persiste pas `sig`. Cette limite est propre à cette cible
de dépendance : le moteur visé (`engine-task-priorities`, identique à `origin/master`) accepte
`signer` et persiste la signature, et son workflow `CI` comprend l’installation reproductible,
les tests, le typecheck ainsi qu’un test de cette écriture. Cela prouve la couverture du
workflow, pas qu’un run CI donné a réussi. Vérifier la version moteur effectivement livrée.

La priorité est une préférence de planification, pas une autorisation ; son champ est
indépendant du HMAC. L’API cockpit authentifiée vérifie l’identité et le droit d’écriture
avant l’appel à l’EventStore. Une commande `run.reprioritize` signée élargirait le contrat des
kinds et des consommateurs HMAC ; elle n’est pas retenue.

Le moteur doit sélectionner transactionnellement selon l’ordre décrit ci-dessus et exposer
une API EventStore pour reclassifier le champ `payload_json` avant réservation. Les boucles
de reprise/approbation/revérification, publieur, livreur et maître distant consomment des
ensembles de kinds distincts ; seul le sélecteur de la boucle des runs est concerné par la
priorité des tâches. La reclassification échoue proprement si la réservation a déjà eu lieu.
