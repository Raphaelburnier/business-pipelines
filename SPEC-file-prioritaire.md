# file-prioritaire

Cadrage validé : [carte des capacités](CAPABILITY-MAP-pipelines-missions-calendrier.md).

## Objectif

Sélectionner atomiquement les commandes admissibles : reprises, objectifs dus, missions ponctuelles.

## Contrat et architecture

Étendre scheduling (source, notBefore) et la sélection du moteur avec une exclusion des commandes indisponibles. Le runner contrôle les machines et quotas avant réservation. Les reprises gardent leur contrat et leur run. Aucun contrôle humain n’est auto-validé.

## Structure et style

API et stockage dans `src/`, intégration dans `bin/`, composants React TypeScript dans `web/src/atelier/`. Schémas et file du moteur dans le worktree agent-orchestrator associé. CommonJS côté serveur, fonctions nommées en français, entrées validées au serveur. Exemple : `const commande = store.creerCommande({ kind: "run.start", payload, par: qui.par, canal: qui.canal });`.

## Validation

Trier reprise/date/priorité ; ignorer un travail futur ou bloqué ; ne pas réserver deux fois ; conserver les métadonnées lors du reclassement.

Tests ciblés : `node test/atelier.test.js`, `npm --prefix web test`, `npm --prefix web run typecheck`, `npm --prefix web run build`. Moteur : `npm test`. Suite cockpit : `npm test`. Les agents des tests sont simulés ; aucune recette ne consomme un abonnement ni ne démarre de run de production.

## Limites

Toujours : même event store, contrôles de projet, identités issues de la session, sauvegarde serveur et reprise sans doublon. Autorisation de fusion explicite pour les fichiers sensibles conformément aux règles existantes. Jamais : secret dans une définition, outil supplémentaire accordé par le client, suppression de contrôle de publication, remplacement implicite d’un agent choisi.
