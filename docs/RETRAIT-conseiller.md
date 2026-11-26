# Retrait du conseiller des approbations

Résumé : retirer les avis automatiques et la discussion du conseiller, à la demande du 26 novembre 2026. Préserver les décisions humaines, leur archivage et l’index du vault utilisé par Demander. Fusion et recette après livraison humaine restent nécessaires.

## Comportement attendu

- La page Décisions ne montre plus les avis, le badge du modèle ou le fil du conseiller. Les approbations, refus et consignes restent disponibles.
- Le NAS ne crée ni ne distribue de travail d’avis ou de réponse. Les travaux historiques de ces genres sont abandonnés, sans effacer les données.
- Le PC n’appelle plus Ollama. Face à un NAS plus ancien, il refuse les travaux autres que les notes. Face à un ancien PC, le NAS ne distribue que des notes.
- Le pont continue de synchroniser le vault et d’archiver les décisions humaines. Les nouvelles notes n’incluent plus d’avis générés. Les anciennes notes restent intactes.

## Compatibilité

Les noms `conseiller-pc.service`, `bin/conseiller-pc.js`, `src/conseiller.js`, les réglages `CONSEILLER_*`, la base existante et les routes de transport sont conservés pour le seul pont vault. Pourquoi : ces noms sont déjà installés ; les changer pendant le retrait couperait l’index de Demander, l’archivage ou l’authentification du quota. Aucun nouveau protocole ni migration destructive.

Les anciennes routes `/api/conseiller/dossiers/*` répondent 410. Les routes d’agent existantes gardent leur authentification et leur format, mais `travail` ne rend plus que le genre `note`. Un résultat d’ancien avis est ignoré, même s’il revient après la bascule.

## Vérification et activation

Exécuter `node test/conseiller.test.js`, `node test/acces.test.js`, `npm test`, `npm --prefix web run typecheck`, `npm --prefix web test` et `npm --prefix web run build`. Vérifier localement la page Décisions en maquette, ses choix humains et l’absence du conseiller.

Après fusion, la livraison NAS est demandée par Raphaël depuis le cockpit. Le service PC doit ensuite être actualisé depuis la version fusionnée ; son unité ne dépend plus d’Ollama. Ne pas supprimer sa base ni modifier ses secrets. Après actualisation des deux côtés : constater l’absence d’avis, une synchronisation du vault et l’archivage d’une décision normale avant de clore 10.6.

## Réserves sur le dossier marketing

La lecture de l’artefact complet confirme quatre réponses et trois arbitrages : la question du canal hors plateforme reçoit une réponse consensuelle, donc aucune action supplémentaire n’est nécessaire. Le nombre de cartes d’arbitrage ne mesure pas la couverture du plan.

Le brief de synthèse demandait « ce que refuser implique », ce qui favorisait des conséquences automatiques sans preuve. [Registre #52](https://github.com/Raphaelburnier/agent-registry/pull/52) prépare `plan-synthesist@2` et `marketing@2`, avec les mêmes sorties et contrôles : alternatives explicites, bénéfices conditionnels et tailles d’essai ajustables. Les versions existantes restent figées. Cette préparation ne change ni le run en attente ni les fiches projet épinglées sur `marketing@1` ; le choix de la nouvelle version et sa recette restent à faire après fusion et livraison humaine du registre.

## Résultats locaux

Le contrôle de la feuille, la suite serveur complète, les 100 tests front, TypeScript et le build passent. Le navigateur local en maquette confirme l’absence du conseiller et la présence des choix humains, sur ordinateur et à 390 pixels, sans débordement horizontal. Les tests serveur vérifient notamment le refus des anciens fils, l’abandon des travaux d’avis et la conservation du pont vault et de ses baux.
