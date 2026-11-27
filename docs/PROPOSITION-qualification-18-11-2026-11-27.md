# Qualification des douze étapes anciennes — cadrage validé

Résumé : compléter le cadrage des douze étapes ouvertes qui n'ont pas de phase,
sur le schéma déjà approuvé. La répartition validée donne neuf attentes de
recette, six blocages et un développement, celui de 18.11. Tous les statuts
restent `en-cours` ; aucune clôture ni certification du plafond n'est demandée
par cette migration. Les critères et la migration ont été validés explicitement
le 27 novembre 2026, puis appliqués à la source de suivi.

## Objectif et périmètre

La PR #321 a corrigé les phases déjà formalisées, sans inventer les critères des
anciennes étapes. Cette proposition traite maintenant ces critères. Elle reprend
les fonctions et les attentes existantes et rend explicites deux décisions :
le budget global courant de trois tentatives pour 6.4 et le périmètre des cinq
projets de code recensés pour 16.9.

La base contrôlée est `a3fcf2cbadfa0c34e73079e215212767f52ddec6`. La proposition
ne modifie ni le moteur, ni le registre, ni le contrat des missions, ni les
épinglages des projets. Elle n'autorise aucun départ de run. Les quatre étapes
déjà cadrées, le catalogue et l'archive sont conservés.

## Qualification validée

Les formulations exactes des critères et des attentes figurent dans
[le fichier de proposition](propositions/qualification-18-11-2026-11-27.json).
Ce fichier est un document de préparation : aucun lecteur du cockpit ne le charge.

| Étape | Phase validée | Résultat exigé et attente actuelle |
| --- | --- | --- |
| 1.3 | Recette attendue | Un échec hérité réel est reconnu par ses diagnostics stables sans consommer le budget de correction de la PR. Un diagnostic différent ou une preuve absente conserve le parcours normal. La recette du correctif #307 manque encore. |
| 2.11 | Recette attendue | Dans un run réel, la réserve retient le prochain appel Codex au seuil ou sans mesure fraîche, puis reprend le même run. Réserve Claude et compteurs de quota restent indépendants. Le cas en plein run reste à observer. |
| 5.3 | Recette attendue | Un défaut corrigeable de main produit une seule réservation par commit puis une PR soumise aux contrôles ordinaires. Ni push direct sur main ni nouveau travail pour une réservation occupée. La création de PR manque encore dans la recette. |
| 6.2 | Bloqué | Le relais Codex remplace une revue Claude indisponible et le gate exige le verdict approuvé sur la tête exacte. La métadonnée OPENAI_API_KEY est absente des trois dépôts au contrôle du 27 novembre. Sa configuration protégée et la recette restent nécessaires. |
| 6.4 | Recette attendue | Une nouvelle correction sur une autre étape reste possible dans le budget courant de trois démarrages par PR ; doublons et quatrième démarrage sont refusés. La recette historique #120 prouve deux corrections et une CI verte après relance humaine, pas la totalité du fonctionnement automatique actuel. |
| 15.2 | Bloqué | Les habitudes de contexte couvrent changement de tâche, échecs répétés, compaction et exploration déléguée lorsqu'elle est autorisée. Leur application doit être constatée en session. Le gel du lot 15 reste en vigueur ; dépendance proposée explicite vers 18.11. |
| 16.4 | Bloqué | Retirer intégralement les agents visés seulement quand plus aucune version de pipeline ni nature ne les cite ; conserver versions figées et fiches d'équipe utiles. La nature marketing courante cite encore content-planner et content-writer ; dépendance proposée explicite vers 16.8. |
| 16.7 | Bloqué | Après choix explicite de version, Finance utilise finance-research@4 avec finance-snapshot-analysis@2 ; un run métier autorisé termine avec un rapport validé. Le projet est encore sur finance-research@2. Cette proposition ne le migre pas. |
| 16.9 | Bloqué | Les cinq projets de code recensés utilisent une version chargeant revue-code@1 ; une revue réelle atteste ce chargement et son résultat. Les versions plus récentes restent épinglées et aucun ancien run n'est réécrit. Deux projets sont encore sur improve-app@8. |
| 18.4 | Bloqué | L'activation du bac à sable Claude et Codex sur le worker réellement utilisé est attestée ; les accès privés sont refusés et le jeton de communication n'arrive pas aux shells des agents. Cette activation n'est pas attestée par le contrôle présent ; aucun fichier protégé n'a été consulté. |
| 18.11 | Développement | Chaque étape ouverte reçoit une phase justifiée. Une phase absente ou un travail inconnu compte par prudence comme développement actif. Un relevé courant, avec confirmation des reprises interactives, doit établir au plus trois développements ; aucun lot n'est clôturé pour arranger le compte. |
| 18.26 | Recette attendue | Un vrai run Claude déclenche la restriction à l'écriture d'une sortie manquante aux deux tiers du plafond ; les outils reviennent après écriture. La recette CLI est connue, l'observation sur un vrai run manque. Codex reste hors périmètre. |

Les cinq projets retenus pour 16.9 sont agent-orchestrator, agent-registry,
agent-secrets, business-pipelines et steam-tierlist, présents dans la topologie
consultée. Les deux premiers épinglages à migrer sont ceux qui restent en
version 8 : agent-orchestrator et steam-tierlist. Les trois projets déjà en
version 10 ne sont pas rétrogradés. L'admission de nouveaux projets n'élargit
pas automatiquement ce périmètre.

## Preuves contrôlées le 27 novembre

- L'inventaire du 26 novembre et la feuille de `main` concordent sur les douze
  étapes sans cadrage. Les attributions consultées ne réservent pas 18.11.
- Les listes de métadonnées des secrets GitHub confirment l'absence de
  OPENAI_API_KEY dans les trois dépôts système. Aucune valeur de secret n'a
  été lue et aucun secret n'a été créé.
- La topologie servie indique Finance en version 2, deux projets de code en
  version 8 et trois en version 10. Les réponses complètes restent hors du
  dépôt public.
- La nature marketing lue sur la branche par défaut du registre cite encore
  les deux agents conservés. Leur retrait ne peut pas être annoncé comme fait.
- Sur [#120](https://github.com/Raphaelburnier/business-pipelines/pull/120),
  le commit `d3368f3a3cc471b77c8a0a3d5c9809a736df6572` corrige le MIME mais
  la [CI 39022264527](https://github.com/Raphaelburnier/business-pipelines/actions/runs/39022264527)
  échoue sur les tests et types web. Après la relance humaine, le commit
  `c338128fd6a96c76411d2cf0413d1c6f9b962c14` corrige le type et la
  [CI 39022607235](https://github.com/Raphaelburnier/business-pipelines/actions/runs/39022607235)
  réussit. La PR de recette est fermée sans fusion : ses défauts volontairement
  introduits n'ont pas à être intégrés.
- À 11 h 26 UTC, la santé du cockpit est dégradée : sonde Docker du cockpit
  en échec. La version servie reste antérieure à #321. Ce relevé empêche de
  revendiquer une nouvelle recette de production, sans justifier un
  redémarrage ou une livraison par l'agent.

## Schéma, valeurs par défaut et clôture

Utiliser seulement `cadrage` et `suivi` de
[SPEC-cadrage-lots.md](SPEC-cadrage-lots.md). Chaque première migration prend
la révision 1, des critères explicites et les deux dépendances proposées
ci-dessus ; les autres listes de dépendances restent vides. Ce choix a été validé explicitement, sans extraction automatique des
prérequis depuis la prose.

Fusion et recette sont requises pour chaque clôture. Les preuves historiques
restent accessibles et de nouvelles références ne sont ajoutées qu'après contrôle
de leur résultat et de leur commit. Aucune preuve n'est fabriquée pour remplir
le schéma ; une liste vide à la migration n'annonce aucun résultat acquis.

La migration garde les seize étapes ouvertes. Le compte proposé est neuf
recettes attendues, six blocages et un développement ; il ne prouve pas à lui
seul l'absence de sessions interactives sur une étape en attente. 18.11 reste
ouvert jusqu'à confirmation du travail réellement actif et de ses responsables.
Cette proposition ajoute de la qualification, pas un nouveau limiteur serveur.

Pourquoi compter une étape inconnue comme active : l'absence de suivi ne doit
pas libérer artificiellement une place. Pourquoi conserver les blocages : une
action humaine ou une dépendance en attente n'est ni du code à réécrire ni une
preuve que le lot est terminé.

## Fichiers, conventions et vérification

La source active reste `web/src/avenir/feuille.json`, avec une étape par ligne
selon le formateur existant. `feuille.ts` garde son rôle de lecture ; aucune
seconde source de suivi n'y est créée. Le catalogue `objectifs.json`, l'archive
et les missions historiques ne sont pas modifiés par cette qualification.

Exemple de représentation, avec les valeurs du schéma existant :

```json
{"phase":"bloque","attente":"Action ou preuve encore nécessaire.","preuves":[]}
```

La simulation des douze cadrages et phases passe `creerCadreur` et
`validerEvolution` contre la base de #321. Elle ne modifie aucun statut et
donne une feuille de 94 472 octets, sous la limite de revue de 100 000 octets.
La vérification appliquée après accord reprend ces contrôles. Ils valident
le format, pas la réussite des recettes ni le compte réel
des sessions actives.

Les commandes de validation de la migration sont :

```sh
npm run feuille:formater
node bin/valider-feuille.js --base origin/main
node --test test/cadrage-lots.test.js
```

La vérification confronte en plus chaque attente à sa source, conserve toutes
les autres entrées et confirme que les douze étapes ouvertes ne deviennent pas
réattribuables. Une nouvelle révision est nécessaire si une mission déjà cadrée
change de sens. Aucun nouveau test n'est requis pour du texte de suivi seul.

## Limites et validation

Toujours conserver les résultats historiques, les gels et les preuves manquantes.
Les critères proposés n'autorisent aucune mutation des projets ni de leurs runs.
Une activation protégée, une montée de version de projet ou une livraison reste
une action distincte selon les règles existantes. Ne pas modifier les workflows
de fusion, les fichiers sensibles ou les limites de revue pour cette migration.

L’accord explicite du 27 novembre porte sur les douze critères et phases, dont
les trois tentatives globales de 6.4, le périmètre des cinq projets de 16.9 et
les dépendances explicites 15.2 → 18.11 et 16.4 → 16.8. Les décisions
opérationnelles et les recettes restent ouvertes après cette validation. Le
fichier JSON joint conserve la proposition approuvée comme référence historique ;
la feuille active précise que le périmètre de 16.9 est confirmé et que 18.11
attend encore la certification du travail réel. Les autres critères sont repris
à l’identique.

## Application du cadrage approuvé

Les douze cadrages sont appliqués à la feuille sur la base de #321. Le
validateur et les douze tests de cadrage passent. Le contrôle direct confirme
que les douze critères et dépendances restent ceux approuvés, que tous les
statuts et les anciennes preuves sont préservés, et que le catalogue et
l’archive sont identiques à la base. Les douze étapes restent non réattribuables.
Le contrôle TypeScript et les 100 tests du front passent également.
La feuille appliquée fait 94 633 octets. La certification du travail réel et
la recette après livraison humaine restent nécessaires pour clôturer 18.11.
