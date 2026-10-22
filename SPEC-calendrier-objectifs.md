# calendrier-objectifs

Cadrage validé : [carte des capacités](CAPABILITY-MAP-pipelines-missions-calendrier.md).

## Objectif

Planifier des objectifs datés ou récurrents et suivre leurs résultats dans une semaine ou une journée.

## Contrat et architecture

Conserver les dates civiles Europe/Zurich et leur instant UTC. Créer chaque occurrence et sa commande en une transaction ; une occurrence active empêche le chevauchement suivant. Activation/pause explicites. Éditer dates et priorités avec révision optimiste, sans recréer un travail commencé.

## Structure et style

API et stockage dans `src/`, intégration dans `bin/`, composants React TypeScript dans `web/src/atelier/`. Schémas et file du moteur dans le worktree agent-orchestrator associé. CommonJS côté serveur, fonctions nommées en français, entrées validées au serveur. Exemple : `const commande = store.creerCommande({ kind: "run.start", payload, par: qui.par, canal: qui.canal });`.

## Validation

Couvrir les changements d’heure, les heures inexistantes, deux programmateurs, redémarrage, reports, récurrence sans chevauchement et priorité au retour de quota.

Tests ciblés : `node test/atelier.test.js`, `npm --prefix web test`, `npm --prefix web run typecheck`, `npm --prefix web run build`. Moteur : `npm test`. Suite cockpit : `npm test`. Les agents des tests sont simulés ; aucune recette ne consomme un abonnement ni ne démarre de run de production.

## Limites

Toujours : même event store, contrôles de projet, identités issues de la session, sauvegarde serveur et reprise sans doublon. Autorisation de fusion explicite pour les fichiers sensibles conformément aux règles existantes. Jamais : secret dans une définition, outil supplémentaire accordé par le client, suppression de contrôle de publication, remplacement implicite d’un agent choisi.
