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
  existant si l’échéance du fournisseur est connue ; sinon l’état reste visible et la
  reprise manuelle actuelle s’applique.
- Les objectifs différents peuvent être attribués à des agents différents ; l’ordonnanceur
  respecte la capacité disponible du worker.

## Hors périmètre du MVP

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
- La reprise après quota utilise le même run et sa charge immuable. Les attentes sans date
  fiable ne sont pas relancées automatiquement.

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
  nouvelle attribution ; échéance inconnue → attente visible et pas de relance inventée.
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
5. Une échéance inconnue reste en attente et requiert la reprise manuelle existante.
6. Les fusions et livraisons continuent d’appliquer leurs contrôles habituels.

## Décision UX validée

- Le formulaire préremplit le titre et le détail depuis « À venir ».
- L’utilisateur choisit le projet et l’agent, puis peut ajuster les critères de réussite
  avant le lancement.
