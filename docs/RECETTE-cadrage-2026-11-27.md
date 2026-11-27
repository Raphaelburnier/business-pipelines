# Cadrage des lots : recette du 27 novembre 2026

Résumé : O8 est corrigé, livré et vérifié ; sa clôture est proposée. Les contrôles
fonctionnels du cadrage O7 passent aussi, mais la santé globale renvoie encore
HTTP 503 pour `docker_cockpit`, après la fin de livraison. O7 reste bloqué.
La prochaine étape est de lire le dernier échec de la sonde Docker, puis de
reprendre ce contrôle. Aucun lot 19/20 ni nouvelle livraison n'est lancé.

## Version installée

La livraison humaine `755b2db8-1bd7-4e8a-9596-fabbe95abed6` est terminée avec
l'issue `livree` le 27 novembre à 11:39:27 UTC. Versions relues dans l'API :

- Cockpit : `a3fcf2cbadfa0c34e73079e215212767f52ddec6`.
- Moteur : `d6c91b194bbe50b01d131d069fc719f61825a514`.
- Registre : `e023e74af573e01d10096cd6f15fe6ad0aa828aa`.

Le commit de fusion de #311, `5a840ef58fbdb2e0177ac97f61efd4abeaabae32`, est
un ancêtre de cette version du cockpit. La PR #303 de recette partielle est
fusionnée en `9536671ed684bebee8d10b21c7762764ed26f51f`.

## O8 : liens directs et rechargement

Les GET vers `/taskboard`, `/taskboard/taches` et `/taskboard/activite` répondent
HTTP 200 et servent le même document HTML. `/taskboard/inconnu` reste en HTTP 404.
La correction reste donc limitée aux onglets connus du Planning.

Dans Opera, l'ouverture directe de Tâches puis une nouvelle navigation à cette
adresse affichent Planning et ses onglets. Activité s'ouvre également sous son
adresse directe ; une nouvelle navigation à cette adresse après la bascule
retrouve la page Planning. Aucune commande de planification ni action sur un run
n'a été effectuée. Un chargement a affiché « Cockpit injoignable » pendant la livraison ;
l’adresse Activité a ensuite retrouvé la page Planning.

Le test du vrai serveur confirme ces routes, les contrôles d'hôte et le refus des
segments inconnus : `node test/cockpit-routes.test.js`, 6/6 réussis, avec le front
construit présent. O8 est absent du catalogue des objectifs et ne doit pas être
réattribué. Son passage à `fait` l'envoie dans la feuille d'archive.

## Verification isolee

Les tests utilisent le cockpit `a3fcf2c` et les sources du moteur `d6c91b1`, avec
les dépendances verrouillées correspondantes. Commandes exécutées :

```sh
npm --prefix web run build
node test/cockpit-routes.test.js
node --test test/cadrage-lots.test.js test/planificateur.test.js test/reprises-runs.test.js
npm --prefix web test
node bin/valider-feuille.js --base origin/main
```

Résultats : compilation TypeScript et build réussis ; 6 tests de routes, 65 tests
de cadrage/planification/reprise et 100 tests front réussis. Les reprises utilisent
un fournisseur simulé. Aucun appel de modèle réel ni commande de production n'est
émis par ces vérifications.

## O7 : disponibilité locale et santé globale

À 12:00:20 UTC, après la fin de livraison, la sonde locale `/sante` répond HTTP 200
avec `ok: true`. Les lectures des objectifs et des attributions répondent aussi
HTTP 200. `/api/sante` répond pourtant HTTP 503 : tous les contrôles annoncés sont
disponibles sauf `docker_cockpit`, avec le code `SONDE_ECHOUEE`.

Un second relevé à 12:02:31 UTC confirme le même échec sur le même triplet installé.
La disponibilité des lectures ne suffit donc pas à déclarer la panne résolue.

Le code vérifié distingue bien `/sante`, qui teste la base locale, du verdict
global `/api/sante` ; la sonde ne dépend pas de son propre résultat Docker.
Le client de la sonde impose 1,5 seconde au HTTP et Compose borne le processus
à quatre secondes. Ces limites sont constatées, sans conclure qu'elles causent
l'échec : le diagnostic Docker manque encore.

La tentative SSH en lecture seule est refusée par la vérification de la clé
d'hôte. Aucune clé n'est acceptée automatiquement, aucun contrôle d'accès n'est
désactivé et aucun service n'est redémarré. Lecture opérateur demandée depuis DSM :

```sh
docker inspect --format '{{range .State.Health.Log}}{{.End}} code={{.ExitCode}} {{.Output}}{{end}}' business_cockpit
```

Le script actuel n'écrit qu'un message générique en cas d'échec ; Docker peut
aussi signaler un dépassement du délai du processus. Relever ce résultat avant
de modifier la sonde. Aucune cause ni correction de santé n'est revendiquée.

O7 conserve son statut `en-cours` et sa phase `bloque`, avec cette vérification
fonctionnelle sur la version réellement installée. Aucune preuve de recette
complète n'est ajoutée. Les résultats du 24 novembre restent dans
[le rapport précédent](RECETTE-cadrage-2026-11-24.md).
