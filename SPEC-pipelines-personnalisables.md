# pipelines-personnalisables

Cadrage validé : [carte des capacités](CAPABILITY-MAP-pipelines-missions-calendrier.md).

## Objectif

Composer dans Pipelines du projet une définition exécutable réutilisable et versionnée.

## Contrat et architecture

Utiliser React Flow et les schémas existants. Sauvegarder des versions immuables dans des tables dédiées de l’event store, avec contrôle optimiste. Charger agents et outils depuis le registre côté serveur. Conserver les étapes de contrôle des pipelines attachés ; les créations libres utilisent un workspace documentaire sans publication de code.

## Structure et style

API et stockage dans `src/`, intégration dans `bin/`, composants React TypeScript dans `web/src/atelier/`. Schémas et file du moteur dans le worktree agent-orchestrator associé. CommonJS côté serveur, fonctions nommées en français, entrées validées au serveur. Exemple : `const commande = store.creerCommande({ kind: "run.start", payload, par: qui.par, canal: qui.canal });`.

## Validation

Ajouter/déplacer/connecter des agents ; adapter consignes et affectations ; recharger une version ; refuser les graphes invalides, les suppressions de contrôles et les écritures concurrentes périmées.

Tests ciblés : `node test/atelier.test.js`, `npm --prefix web test`, `npm --prefix web run typecheck`, `npm --prefix web run build`. Moteur : `npm test`. Suite cockpit : `npm test`. Les agents des tests sont simulés ; aucune recette ne consomme un abonnement ni ne démarre de run de production.

## Limites

Toujours : même event store, contrôles de projet, identités issues de la session, sauvegarde serveur et reprise sans doublon. Autorisation de fusion explicite pour les fichiers sensibles conformément aux règles existantes. Jamais : secret dans une définition, outil supplémentaire accordé par le client, suppression de contrôle de publication, remplacement implicite d’un agent choisi.
