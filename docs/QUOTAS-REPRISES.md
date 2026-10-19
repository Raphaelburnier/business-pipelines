# Attentes et reprises dans le cockpit

Une attente de quota montre le runtime, la machine, le compte configuré, la cause,
l'échéance fournisseur connue et la prochaine reprise automatique. Si aucune date
fiable n'est fournie, l'écran indique **échéance inconnue** et propose une reprise
manuelle. Les montants USD restent des équivalents ; aucune jauge d'abonnement n'en
est déduite.

Une connexion expirée montre la commande de reconnexion sur la machine concernée.
Le bouton de reprise exige que l'opérateur confirme avoir reconnecté le runtime.
Le précontrôle d'abonnement repasse ensuite lors du vrai lancement.

## API et runner

`POST /api/runs/<id>/reprise` reçoit `{ waitId, reconnexionConfirmee? }`. L'identité
et l'origine sont contrôlées comme pour les autres écritures. Une attente périmée ou
une reconnexion non confirmée produit un 409. L'API impose une reprise manuelle et
rend 202 avec la commande existante en cas de double clic. Le front suit les
changements par le flux et les lectures habituelles de `/api/runs`.

L'API ajoute `attente` aux runs (null hors attente). `src/reprises-runs.js` réalise la
reprise : validation de l'épisode d'attente, puis lancement avec `--resume --run-id`,
en reprenant la charge immuable de la commande de lancement. Aucun nouveau `run.start`,
aucune reconstruction de mission et aucune nouvelle publication après résultat.

`bin/commande-runner.js` ajoute seulement :

- le bail exclusif avant récupération des commandes interrompues ;
- la réconciliation des anciennes attentes, dont les dates restent inconnues ;
- `run.resume` dans le filtre de récupération et la file des runs ;
- la programmation des quotas connus à chaque passage de cette file ;
- le branchement vers `reprendreRun` et la clôture du lien de commande.

Pour une mission issue d'un objectif « À venir », ces reprises ne créent jamais de deuxième
`run.start`. La projection de l'objectif continue à pointer sur sa commande et son `runId`
d'origine pendant l'attente et après redémarrage du runner. La commande `run.resume` est une
action de reprise liée au même run. L'état du run peut être terminé alors que la livraison
reste en attente de revue ou de fusion ; consulter séparément `livraison` dans la projection.

Les commandes de conversations et d'approbations restent compatibles. Les nouveaux
modules/pages de conversation, la préparation de missions, les handlers et les
pipelines marketing restent au chantier marketing. Lors de son intégration, conserver
ces cinq branchements et l'ajout de `test/reprises-runs.test.js` à la commande `npm test`.
Qwen conserve son rôle de conseiller et aucun outil d'action ne lui est ajouté.

Le moteur compagnon décrit les échéances et les bornes dans `docs/QUOTAS-REPRISES.md` :
trois reprises par run, 24 heures d'attente automatique, trois reprises par compte/runtime
sur 24 heures ; durée et inactivité des exécuteurs bornées. La CI épingle ce moteur
pour vérifier ensemble l'API, les schémas et le runner.

## Contrôles et livraison

La suite serveur inclut cinq recettes avec le vrai runner/CLI et un exécutable fournisseur
simulé : quota connu → redémarrage → même mission malgré des sources modifiées → même
workspace/session, quota inconnu manuel, connexion explicite, second runner refusé, rejeu
après réussite sans nouveau lancement. Les routes HTTP couvrent origine, identité,
confirmation, commande unique, attente et session visibles. Typecheck/tests/build web
restent dans la CI existante, qui vérifie aussi le build Docker de livraison.

Fusion explicite du moteur puis du cockpit, livraison NAS conjointe, puis actualisation
du worker PC. Conserver la base SQLite, les workspaces et les journaux contenant les
snapshots de revue sur des volumes persistants. La recette simulée ne valide aucun
épuisement réel d'abonnement ni la publication d'une nouvelle PR métier.

Les boutons cockpit arrêt/pause et les alertes externes ne font pas partie de ce lot.
Les identifiants de compte sont configurés par l'opérateur ; le cockpit ne lit ni ne
transporte les credentials et ne découvre pas les comptes connectés.
