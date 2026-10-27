# Lots 1.3 et 5.3 : CI de base et correction de main

Résumé : éviter de facturer une erreur héritée au correcteur d'une PR et proposer une correction de la branche principale par le circuit isolé existant. Une preuve exacte de base et de diagnostic est nécessaire pour dispenser la PR ; une seule préparation de correction est autorisée par commit de base. La fusion des workflows reste explicite ; la recette GitHub vient ensuite.

## Contrat

- Le tri reste en lecture seule et n'exécute aucun code du dépôt.
- Pour une PR, retrouver le SHA de base dans la preuve `Verify tested merge` réussie, pas dans la base courante qui peut avoir avancé. Lire la dernière CI hors PR sur ce SHA exact. Ne classer `base-rouge` que si toutes les étapes échouées, identifiées par job et nom, et tous les diagnostics normalisés sont identiques et non vides. Une API manquante, une preuve ambiguë ou un diagnostic différent conserve le parcours PR.
- `base-rouge` produit un commentaire dédupliqué distinct ; aucun marqueur de transmission ni commit de correction ne consomme les trois tentatives de la PR.
- Une CI `push`, `schedule` ou `workflow_dispatch` échouée sur la tête courante de la branche par défaut propose une correction sur `automation/ci-main-<sha>`. Valider de nouveau run, tentative et dernière CI. Un autre événement, un fork, une ancienne tête ou une ancienne CI est refusé.
- Réserver atomiquement la branche avant l'appel Claude. Une réservation existante, même si Claude échoue, empêche un nouvel appel pour ce SHA. Le résumé expose le refus ; pas de relance illimitée par la CI nocturne.
- Réutiliser l'isolement de Claude et la validation des patchs. La validation et le push relisent la base et la réservation. Ne jamais pousser sur la branche principale ; ne jamais forcer un push.
- Créer la PR avec le jeton d'application après le push pour déclencher la CI normale ; les contrôles de revue et de fusion existants s'appliquent. Un échec de création laisse la branche et le diagnostic accessibles pour reprise manuelle.
- Le suivi du cockpit ne passe à `fait` qu'après intégration et recette ; préparation affichée `en-cours`.

## Vérification

`node --test test/ci-autofix.test.js` exécute le Bash réel contre GitHub simulé et de vrais dépôts temporaires : bases rouge/verte/inconnue, même étape avec autre erreur, échec mixte, tête déplacée, doublon, réservation, patch sensible, publication et ouverture de PR. `npm test`, `npm run web:test`, puis `npm --prefix web run build` vérifient l'intégration.

Documentation API : [workflow runs](https://docs.github.com/en/rest/actions/workflow-runs), [pull requests](https://docs.github.com/en/rest/pulls/pulls). Les événements `workflow_run` utilisent le workflow de la branche par défaut : la recette réelle exige sa fusion explicite.
