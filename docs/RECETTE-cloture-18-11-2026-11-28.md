# 18.11 : plafond actif et recette de clôture

Résumé : les dix-neuf étapes ouvertes ont une phase justifiée, dont trois en
développement : 18.19, 18.22 et 18.24. La confirmation humaine des reprises
interactives est reçue. Le cockpit livré affiche ce suivi et reste sain au
contrôle du 28 novembre. La clôture de 18.11 ne libère aucune place de
développement : les trois places restent occupées, les recettes manquantes et
le gel du lot 15 restent inscrits.

## Versions et périmètre vérifiés

Le 28 novembre à 14:47:22 UTC, `/api/sante` répond HTTP 200, état `sain`, avec
tous ses composants disponibles. Versions effectivement servies :

- Cockpit : `30c240e67250a8472911d13729100dd77ad7fb29`.
- Moteur : `d6c91b194bbe50b01d131d069fc719f61825a514`.
- Registre : `26b097e7960a2bb12bc8c9e33ed38ad10ea22887`.

Le cockpit contient les fusions du suivi initial
[#321](https://github.com/Raphaelburnier/business-pipelines/pull/321)
(`a3fcf2cbadfa0c34e73079e215212767f52ddec6`), de la qualification
[#322](https://github.com/Raphaelburnier/business-pipelines/pull/322)
(`862afd4c1662bb0b040088a88628ddc638586f57`) et du relevé des reprises
[#324](https://github.com/Raphaelburnier/business-pipelines/pull/324)
(`e62eb4efc0e3e545d315bb6b9447f2fa8391dda0`). Ascendances vérifiées avec
`git merge-base --is-ancestor`. La version servie est identique au commit de
base de cette clôture ; aucune livraison n'a été demandée par cette session.

## Développements et reprises interactives

L'assemblage des feuilles principale et archivée de `30c240e` donne :

| Phase | Étapes ouvertes |
| --- | --- |
| Développement (3) | 18.19, 18.22, 18.24 |
| Recette attendue (10) | 1.3, 2.11, 5.3, 6.4, 10.4, 10.6, 17.7, 18.11, 18.26, 18.27 |
| Bloqué (6) | 6.2, 15.2, 16.4, 16.7, 16.9, 18.4 |

Aucune des dix-neuf étapes n'est sans phase. Le
[relevé du 27 novembre](SUIVI-releve-18-11-2026-11-27.md) documente leur
ouverture. Dans la conversation responsable, l'opérateur a ensuite répondu
explicitement « Oui, ce relevé reste exact » à la question : seuls 18.19,
18.22 et 18.24 sont ouverts en développement, sans autre étape travaillée par
une session interactive. La reprise du 28 novembre poursuit ce même périmètre.

Cette confirmation couvre les reprises hors des runs, y compris celles qui
pourraient concerner les défauts R8, R9 et C1. Ces trois défauts historiques
restent ouverts, sans phase formalisée ; leurs textes renvoient à des recettes
ou à des étapes liées. L'absence de run ne suffit pas à conclure à l'absence
de session interactive : c'est la réponse humaine qui complète ce relevé.

Les lectures des runs et attributions du 28 novembre répondent HTTP 200 : les
vingt derniers runs sont terminés (deux réussis, seize échoués, deux annulés),
aucun n'est vivant ; les six attributions sont terminales (quatre échouées,
deux annulées). Les réponses intégrales restent hors du dépôt public.
Le relevé du 27 novembre signale deux anciennes programmations de 10.4 avec
`active: true` et `nextAt: null` ; elles ne sont ni nettoyées ni relancées ici.

## Recette du suivi livré

La contribution de recette du 27 novembre a vérifié l'affichage sur `e62eb4e`.
Le 28 novembre, une nouvelle ouverture directe de Tâches dans Opera, sur le
cockpit `30c240e`, puis la lecture de l'arbre d'accessibilité confirment :

| Étape | Résultat visible |
| --- | --- |
| 18.11 | En cours, phase Recette attendue ; relevé humain et attente de recette présents. |
| 18.19, 18.22, 18.24 | En cours, phase Développement. |
| 15.2 | Bloqué ; gel du lot 15 explicitement conservé. |
| 18.26 | Recette attendue ; observation sur un vrai run encore nécessaire. |
| 18.27 | Recette attendue ; acceptation du plan de 10.5 encore attendue. |

Aucun formulaire de production n'est soumis. Le navigateur, le suivi versionné
et les API ne remplacent pas les critères de recette des autres étapes.

## Vérifications isolées

Sur le même commit `30c240e` que la recette livrée :

```sh
node bin/valider-feuille.js --base origin/main
node --test test/cadrage-lots.test.js test/planificateur.test.js
npm --prefix web exec -- vitest run src/avenir/AVenir.test.ts
```

Le validateur passe, ainsi que 53 tests serveur (12 de cadrage et 41 du
planificateur) et 12 tests d'interface. Ces contrôles utilisent le moteur
figé `d6c91b1` déjà préparé pour la recette du cadrage, sans fournisseur réel.
Le cadreur refuse la réattribution de 18.11 ; avant clôture, il refuse aussi
19.1 et 20.1 pour dépendance 18.11 non terminée.

## Effet de la clôture

18.11 passe à `fait`, phase `clos`, attente nulle, avec ses preuves de
vérification, fusion et recette. Sa description retire l'attente désormais
résolue et renvoie à ce rapport. Le validateur inclut cette description dans le
contenu contractuel : la révision passe donc à 2. Critères, directives,
exclusions, dépendances, fichiers et exigences de clôture restent identiques.
Les preuves de révision 2 décrivent ces mêmes exigences ; vérification et
recette visent toutes deux `30c240e`. Le relevé de vérification antérieur reste
conservé dans `SUIVI-releve-18-11-2026-11-27.md`, à sa base `b0d9c6f`.

Aucune autre étape ni aucun défaut n'est clos pour réduire le compte. Le
catalogue `objectifs.json` reste identique et ne contient pas 18.11 ; le
serveur continue de refuser sa réattribution. Après cette clôture, 19.1 et
20.1 restent hors catalogue : leur dépendance satisfaite n'autorise pas leur
départ. Le plafond de trois développements est toujours atteint, et le gel
du lot 15 et les recettes restantes sont conservés. Cette règle de cadence
est une discipline de prise en charge, pas une nouvelle limite automatique
ajoutée au moteur par cette PR.

Le suivi de clôture devient effectif sur `main` après fusion par le gate
normal. Son affichage dans le cockpit attend une prochaine livraison humaine.

Après modification du suivi, le validateur, les 53 tests serveur et les 12 tests
d'interface passent également. Les assertions de non-réattribution serveur et
de conservation du plafond passent ; la comparaison avec `origin/main` confirme
que toutes les données hors 18.11 sont identiques. Le catalogue et l'archive
sont inchangés. La feuille reste sous les 100 000 octets et les entrées de
revue (base et tête des fichiers) sous les 500 000 octets.
