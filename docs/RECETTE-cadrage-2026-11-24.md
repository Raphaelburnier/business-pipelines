# Recette du cadrage des lots — 24 novembre 2026

Résumé : le correctif O7 et ses consignes sont livrés. Les contrôles fonctionnels
du cadrage passent dans le navigateur et dans les tests isolés de la version
servie. La clôture reste suspendue : la santé alterne entre succès et échec, et
plusieurs lectures API échouent encore après la livraison. O7 reste en cours,
phase `bloque`. Les liens directs de Planning constituent un défaut distinct, O8.
Prochaine étape : rétablir une lecture stable de la plateforme, puis reprendre
la recette avant toute clôture. Les lots 19/20 ne sont pas démarrés.

## Version contrôlée

- Cockpit : `f01fd46f6212b5875ac0bcb131658c5adf8130e1`.
- Moteur : `691e877db720e62c2f1479e4995d896abd01377a`.
- Registre : `bbc19fed7eb6d1743f18e4e45c5c1648c42c472e`.
- Livraison humaine `23a2840f-bcc5-4f63-9a52-eec26ecd1092`, terminée avec issue
  `livree` le 23 novembre à 23:51:39 UTC, soit le 24 novembre en heure locale.

L'ascendance Git confirme la présence du correctif cockpit #290 et du suivi #297.
Le registre servi est le commit de fusion de #48. Cette session n'a demandé aucune
livraison ni émis de commande de mission, de reprise ou de modification d'un run.

## Contrôles dans le navigateur

Recette Chromium dans une session isolée, sur la vraie plateforme, par l'adresse
existante `/a-venir`. Les gestes se limitent aux filtres, aux détails et à la taille
de la fenêtre. Les captures et réponses brutes restent hors du dépôt public.

| Contrôle | Résultat observé |
| --- | --- |
| O7, bureau 1280 × 900 | Statut en cours, phase « Recette attendue » de la version livrée, pas de bouton de départ. |
| O7, mobile 390 × 844 | Même phase visible après recherche « O7 » ; largeur du contenu 375 pixels pour une fenêtre de 390 pixels. |
| Critères de 20.2 | Trois critères distincts et complets, dépendances `18.11, 20.1`, motif de dépendance non terminée et aucun départ possible. |
| Ancienne tâche 3.6 | Consultable, motif « cadrage manquant », `draggable=false`, aucun bouton de départ. |
| Runs et historique | Aucune action sur les runs ; les cas de reprise et de conservation du contrat sont exercés par les tests isolés. Aucune attribution O7 n'a été reprise. |

La version livrée affiche encore `recette-attendue`. Le suivi proposé par cette
reprise passe à `bloque` pour refléter les échecs de santé constatés ensuite.

## Verification isolee

Un checkout du cockpit `f01fd46` est testé avec le moteur effectivement installé
`691e877`. Les dépendances du moteur ont le même verrou de versions ; les tests
utilisent ses sources exactes, sans toucher aux services de production.

```sh
node --test test/cadrage-lots.test.js test/planificateur.test.js test/reprises-runs.test.js
npm --prefix web run typecheck
npm --prefix web test
```

Résultats : 65 tests serveur réussis, dont les reprises avec le vrai runner et un
fournisseur simulé ; TypeScript valide ; 100 tests front réussis dans 24 fichiers.
Les commandes de vérification ne lancent aucun fournisseur de modèle réel.

## Santé : condition de clôture non satisfaite

Après la fin de livraison, `/api/sante` répond HTTP 200 avec statut `sain` le
23 novembre à 23:52:10 UTC, sur le triplet ci-dessus. Des contrôles suivants
renvoient encore HTTP 503. Les réponses détaillées précédentes identifiaient
`docker_cockpit` et `docker_relais` avec le code `SONDE_ECHOUEE` ; les autres
composants signalés étaient disponibles.

Dans le navigateur, des lectures API échouent en HTTP 502 et les alertes
« Calendrier indisponible », « Tâches projet indisponibles », « Runs indisponibles »
et « Planifications indisponibles » réapparaissent. Certaines lectures directes
des objectifs et attributions réussissent en HTTP 200 : le défaut est intermittent.
Un succès ponctuel ne suffit donc pas à déclarer cette recette complète.

La cause de cette instabilité n'est pas établie. La livraison a chevauché la
recette ; les échecs constatés ensuite empêchent de les attribuer simplement à
la bascule. Aucun redémarrage, changement de configuration ou contournement
d'accès n'a été tenté. Relever les erreurs du relais et des sondes avec les
horodatages correspondants avant de choisir un correctif.

## O8 : liens directs de Planning

Sur la version servie, des GET directs vers `/taskboard/taches` et
`/taskboard/activite` renvoient HTTP 404. `/a-venir` sert l'interface et le client
connaît les deux sous-routes. `bin/cockpit.js` ne dessert que `/taskboard` et
`/taskboard/`, ce qui explique cet écart de routage.

O8 est enregistré à faire, hors catalogue : desservir les routes existantes et
vérifier ouverture directe et rechargement dans le serveur réel. Le cas rejoint
20.1, sous réserve du plafond 18.11. Ce défaut n'est pas un échec du constructeur
de cadrage O7 ; il n'est ni corrigé ni déclaré terminé par cette reprise.
