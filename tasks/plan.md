# Plan technique : objectifs À venir durables

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

## Hors périmètre conservé

Pas de récurrence calendrier, de sélection automatique d’agent, de collaboration multi-agent
sur un même objectif, de nouvel ordonnanceur, ni de fusion automatique sensible. Ces points
restent indépendants du MVP d’attribution durable.
