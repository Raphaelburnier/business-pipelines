# missions-ponctuelles

Cadrage validé : [carte des capacités](CAPABILITY-MAP-pipelines-missions-calendrier.md).

## Objectif

Lancer un agent seul ou un graphe ponctuel, puis retrouver le même travail après quota.

## Contrat et architecture

Construire côté serveur le contrat de mission figé depuis le graphe validé et le projet. Agent explicitement choisi, aucun secours implicite. Réutiliser la commande run.start et le chemin run.resume. Une tâche suit sa commande et son run ; son graphe peut être enregistré comme modèle.

## Structure et style

API et stockage dans `src/`, intégration dans `bin/`, composants React TypeScript dans `web/src/atelier/`. Schémas et file du moteur dans le worktree agent-orchestrator associé. CommonJS côté serveur, fonctions nommées en français, entrées validées au serveur. Exemple : `const commande = store.creerCommande({ kind: "run.start", payload, par: qui.par, canal: qui.canal });`.

## Validation

Vérifier la consigne reçue par l’agent, l’idempotence des soumissions, le gel des affectations et la reprise après modification du modèle.

Tests ciblés : `node test/atelier.test.js`, `npm --prefix web test`, `npm --prefix web run typecheck`, `npm --prefix web run build`. Moteur : `npm test`. Suite cockpit : `npm test`. Les agents des tests sont simulés ; aucune recette ne consomme un abonnement ni ne démarre de run de production.

## Limites

Toujours : même event store, contrôles de projet, identités issues de la session, sauvegarde serveur et reprise sans doublon. Autorisation de fusion explicite pour les fichiers sensibles conformément aux règles existantes. Jamais : secret dans une définition, outil supplémentaire accordé par le client, suppression de contrôle de publication, remplacement implicite d’un agent choisi.
