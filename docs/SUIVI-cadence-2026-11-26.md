# Inventaire des étapes ouvertes — 26 novembre 2026

Résumé : 16 étapes restent `en-cours`. Les phases de 17.7 et
10.6 sont périmées : 17.7 est fusionnée et installée ; 10.6 est fusionnée mais
attend encore l’installation de sa partie serveur. Elles passent en
`recette-attendue`, sans clôture. La PR #320 a déjà corrigé 18.27 pendant
cet inventaire ; son suivi est conservé intégralement. Après correction, quatre étapes ont une phase de recette et douze
restent sans phase formalisée. Le plafond 18.11 demeure ouvert : leur développement
actif ne peut pas être déduit du seul statut historique.

## Ce qui a été contrôlé

La feuille et l'archive ont été lues sur `main` en
`90cf1d211d4813ea445b3838f4562c5efb1e1a5e`. Les trois dépôts système n'avaient
aucune PR ouverte au premier contrôle. Pendant l’inventaire,
[#320](https://github.com/Raphaelburnier/business-pipelines/pull/320) a été
fusionnée en `b5488b98f0d2aaf9b32fd76e0e554bdd302e3efb` : son cadrage de 10.5 et
son suivi de 18.27 sont conservés dans cette branche. Les attributions consultées ne réservent pas
18.11. Aucun run n'est renvoyé par les filtres `running`, `queued`,
`waiting_machine`, `waiting_quota` et `waiting_approval` au moment du relevé.
Ces observations ne recensent pas les sessions interactives ; elles ne prouvent
donc pas l'absence de travail en développement.

La santé était saine à 18 h 54 UTC. La version installée du cockpit était
`a5e765477b5960cc4165cdd81f1c7525d6167784` ; celle du registre,
`e023e74af573e01d10096cd6f15fe6ad0aa828aa`. L'ascendance Git confirme la
présence de #305, #307, #311, #316 et #318 dans le cockpit installé ; #314 en
est absente. Les trois liens directs du Planning répondent en HTML HTTP 200.
Ce contrôle HTTP ne constitue pas une recette des gestes dans le navigateur.

Les réponses complètes des API, qui peuvent contenir des données privées, restent
hors du dépôt public. Aucun lancement, arrêt, changement de réserve, changement
de version de projet ou livraison n'a été demandé pour cet inventaire.

## Les seize étapes

« Attente relevée » décrit la prochaine preuve ou décision connue. Pour les
anciennes étapes sans `suivi`, ce tableau n'ajoute ni critères ni autorisation
de lancement ; leur cadrage doit être confirmé avant une nouvelle attribution.

| Étape | État établi | Attente relevée |
| --- | --- | --- |
| 1.3 | Correctif [#307](https://github.com/Raphaelburnier/business-pipelines/pull/307) fusionné ; CI verte sur sa tête. | Observer le prochain échec hérité reconnu comme base rouge. La recette échouée de #285 ne clôture pas le correctif suivant. |
| 2.11 | Réserve Codex fusionnée par [#248](https://github.com/Raphaelburnier/business-pipelines/pull/248) ; recette partielle décrite dans la feuille. | Observer un appel retenu en plein run. Ne pas provoquer un appel de modèle pour remplir ce suivi. |
| 5.3 | Correcteur de main fusionné par [#195](https://github.com/Raphaelburnier/business-pipelines/pull/195) ; diagnostic sans PR constaté dans la recette historique. | Prouver la création d'une PR sur un défaut corrigeable réel. Un diagnostic juste ne suffit pas. |
| 6.2 | Gate et relais fusionnés, dont [registre #39](https://github.com/Raphaelburnier/agent-registry/pull/39). | Configuration protégée et recette du relais encore indiquées en attente par la feuille. L'absence actuelle de la clé n'a pas été revérifiée ici ; aucun secret n'a été lu. |
| 6.4 | Le correcteur actuel documente trois démarrages au plus par PR et la reprise après un commit de correction ; tests existants. | Retrouver la preuve réelle du cas « autre étape en échec » et son rattachement à #120 avant de décider d'une clôture. État restant à qualifier. |
| 10.4 | [#312](https://github.com/Raphaelburnier/business-pipelines/pull/312) fusionnée ; phase de recette déjà correcte. | Geste Arrêter sur un run vivant dans le cockpit livré. Aucun run n'a été interrompu pour cet inventaire. |
| 10.6 | [#314](https://github.com/Raphaelburnier/business-pipelines/pull/314), [#316](https://github.com/Raphaelburnier/business-pipelines/pull/316), [#317](https://github.com/Raphaelburnier/business-pipelines/pull/317) et [registre #52](https://github.com/Raphaelburnier/agent-registry/pull/52) fusionnées. | Livraison humaine de la partie serveur, actualisation du pont PC et recette de l'absence d'avis, de la synchronisation et de l'archivage. Le choix de marketing@2 reste une décision distincte ; les versions déjà épinglées sont conservées. |
| 15.2 | Préférence de contexte partiellement réalisée d'après la feuille. | Lot 15 gelé par 18.11 ; pas de reprise ici ni de passage artificiel à fait. |
| 16.4 | Quatorze agents retirés par [registre #33](https://github.com/Raphaelburnier/agent-registry/pull/33). La nature marketing locale cite encore content-planner et content-writer. | Confirmer leur retrait complet après 16.8. Une copie locale ne suffit pas à attester l'état installé du registre. |
| 16.7 | Versions Finance publiées par [registre #37](https://github.com/Raphaelburnier/agent-registry/pull/37) ; la feuille indique migration et premier résultat métier manquants. | Contrôler l'épinglage réel du projet puis une recette métier autorisée. Aucun projet n'a été migré ici. |
| 16.9 | Skill de revue publié par [registre #35](https://github.com/Raphaelburnier/agent-registry/pull/35) ; chargement historique indiqué dans la feuille. | Confirmer la migration des autres projets et la fin de recette de revue. |
| 17.7 | [#305](https://github.com/Raphaelburnier/business-pipelines/pull/305) fusionnée, présente dans la version installée ; CI verte. | Consigner la recette des états partagés et erreurs des vues concernées sur la version installée. Le job de revue GitHub a échoué : aucune approbation de revue n'est revendiquée par cet inventaire. |
| 18.4 | Bac à sable implémenté ; la feuille indique encore une activation opérateur manquante. | Confirmer l'activation réelle avec l'opérateur. Ni configuration protégée ni jeton consulté. |
| 18.11 | Inventaire et correction du suivi en cours dans cette session. | Qualifier les douze étapes anciennes sans phase, puis prouver le compte du développement actif. Reste ouvert. |
| 18.26 | [Moteur #136](https://github.com/Raphaelburnier/agent-orchestrator/pull/136) fusionné ; recette CLI contrôlée déjà documentée. | Observer la sortie imposée sur un vrai run. La feuille indique cette preuve encore manquante ; aucun run n'a été relancé. |
| 18.27 | [#318](https://github.com/Raphaelburnier/business-pipelines/pull/318) fusionnée et installée ; CI et revue vertes sur sa tête. | Consigner la recette des lecteurs et d'une dépendance vers une étape archivée. |

## Conséquence pour 18.11

Par rapport à la base initiale de l’inventaire, les phases formalisées passent
de deux développements, une fusion attendue et une recette attendue à quatre
recettes attendues. La correction de 18.27 appartient à #320, intégrée sans
modification de son cadrage de 10.5 ni de ses preuves et de son attente de recette. Les seize statuts restent
`en-cours`. Ce changement corrige le suivi ; il ne démontre pas encore une
réduction du développement actif à trois.

Les douze étapes restantes n'ont pas de phase formalisée. Le schéma existant
refuse un `suivi` sans `cadrage` ; les migrer impose de confirmer leurs critères,
leurs dépendances et leurs conditions de fin, conformément à
[SPEC-cadrage-lots.md](SPEC-cadrage-lots.md). Un ancien détail vague ne devient
pas automatiquement un critère d'acceptation. La présente PR conserve ces
étapes et ne les remet pas dans le catalogue des objectifs attribuables.

La prochaine décision porte sur les travaux à finir ou à suspendre et leurs
responsables, après confirmation de ce qui est réellement actif. Les attentes
de recette restent visibles, et aucun nouveau chantier n'est ouvert au titre
de cet inventaire.

## Vérification du changement de suivi

Le contrôle `node bin/valider-feuille.js --base origin/main` vérifie les phases,
les preuves et la cohérence du catalogue. La suite existante
`node --test test/cadrage-lots.test.js` couvre ces invariants. Le changement ne
touche ni le code serveur, ni l'interface, ni le catalogue, ni le cadrage des
missions déjà définies. Il ne clôture aucune étape.
