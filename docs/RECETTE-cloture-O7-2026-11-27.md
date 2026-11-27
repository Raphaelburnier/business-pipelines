# O7 : recette de clôture du 27 novembre 2026

Résumé : les critères du cadrage passent sur la version installée et trois relevés
confirment le retour de la santé globale. O7 peut être clos ; O8 l'est déjà par
la PR #323. Cette PR consigne les preuves et retire le blocage périmé du suivi.
Les lots 19 et 20 restent hors catalogue, gelés par 18.11.

## Versions et fusions

La livraison humaine `c7a22ea1-7378-4593-b34b-7aa8e9e41708` est terminée avec
l'issue `livree` le 27 novembre à 14:05:49 UTC. Versions effectivement servies :

- Cockpit : `e62eb4efc0e3e545d315bb6b9447f2fa8391dda0`.
- Moteur : `d6c91b194bbe50b01d131d069fc719f61825a514`.
- Registre : `26b097e7960a2bb12bc8c9e33ed38ad10ea22887`.

Ces versions contiennent le correctif O7, cockpit #290
(`7c6c7445e9439ebccfc067535b716d5038733c1a`), et les consignes persistantes,
registre #48 (`bbc19fed7eb6d1743f18e4e45c5c1648c42c472e`). Leurs ascendances
sont vérifiées ; le registre servi est cinq commits en avance sur cette fusion.
La clôture d'O8, cockpit #323 (`b0d9c6fc84c2cbfccae12bcc9e4431a84443dc65`),
est également incluse.

## Verification isolee

Les vérifications portent sur le cockpit `e62eb4e` et le moteur `d6c91b1`, avec
les dépendances verrouillées correspondantes :

```sh
npm --prefix web run build
node --test test/cadrage-lots.test.js test/planificateur.test.js test/reprises-runs.test.js
node test/cockpit-routes.test.js
npm --prefix web test
```

Résultats : build et compilation TypeScript réussis ; 65 tests serveur, 6 tests
des routes avec le front construit et 100 tests d'interface réussis.

Le cadrage partagé et les tests couvrent les critères complets transmis par
Attribuer et Calendrier, le but et les dépendances ; le refus des nouveaux départs
sans cadrage ou avec dépendance inachevée, y compris après planification ; les
phases et preuves de clôture. Les reprises et runs actifs conservent leur contrat.
Les fournisseurs des tests de reprise sont simulés, sans appel de modèle réel.

La recette fonctionnelle du matin est conservée dans
[le rapport du 27 novembre](RECETTE-cadrage-2026-11-27.md) ; entre sa version
`a3fcf2c` et `e62eb4e`, les changements du cockpit concernent uniquement les données
et la documentation. Les vérifications ci-dessus ont été rejouées sur `e62eb4e`.

## Recette en production

Sur le même triplet, `/api/sante` répond HTTP 200, état `sain`, avec tous les
composants disponibles à 18:40:25, 18:42:20 et 19:03:35 UTC. Les lectures
`/api/avenir/objectifs` et `/api/atelier/objectifs` répondent HTTP 200. Aucune
livraison n'est en cours au contrôle.

Le blocage HTTP 503 relevé dans les rapports précédents n'est plus présent.
Sa cause précise et celle du rétablissement ne sont pas établies : ces relevés
attestent la disponibilité observée, sans revendiquer une correction de la sonde
Docker ou de la synchronisation automatique. Aucune livraison, aucun redémarrage
ni lancement de mission n'a été émis par cette session.

## Mise à jour du suivi

O7 passe à `fait`, phase `clos`, sans attente restante, puis dans la feuille
d'archive. Il est absent du catalogue des objectifs attribuables. Les autres
cadrages et les gels de 18.11 sont conservés.

Après cette mise à jour, `node bin/valider-feuille.js --base origin/main` réussit,
les 41 tests du planificateur et les 12 tests `AVenir.test.ts` passent. Une
comparaison des feuilles assemblées confirme que toutes les données hors O7 sont
inchangées et que le cadreur refuse sa réattribution.

La révision passe de 1 à 2 car le validateur inclut le texte `correctif` dans le
contenu contractuel : sa description est actualisée pour retirer « implémentation
en cours ». Les critères, directives, exclusions, dépendances et exigences de
clôture restent identiques. Les preuves de cette révision décrivent les mêmes
exigences : vérification et recette visent toutes deux le commit installé
`e62eb4efc0e3e545d315bb6b9447f2fa8391dda0`, les preuves de fusion conservent les
commits des correctifs. La version du code vérifié est distincte de la révision
de sa fiche de suivi.
