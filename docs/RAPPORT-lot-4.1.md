# Lot 4.1 — Pause globale et arrêt d’urgence

## Résumé

Le lot 4.1 est livré et vérifié le 28 octobre 2026 : pause durable des démarrages, annulation explicite par run, conservation des fichiers et confirmation de l’arrêt distant. Les tests de l’image installée et l’interface réelle sur bureau et mobile passent. Les démarrages sont actifs à la fin de la recette. La prochaine étape est la livraison de la feuille de route qui marque le lot « fait ».

## Comportement livré dans le code

- « Suspendre les démarrages » bloque les nouveaux lancements, le calendrier et les reprises quota, machine ou après approbation. La pause survit au redémarrage ; les décisions, le chat, l’administration et les annulations restent traités.
- « Annuler ce run » pose un marqueur durable, retire les reprises prêtes et arrête sa CLI locale. Après le délai coopératif, les processus Linux récalcitrants et leurs descendants recensés sont arrêtés, en vérifiant leur identité.
- Les étapes distantes passent par la file SQLite et le maître. Un worker injoignable ou un arrêt non confirmé reste visible ; l’interface propose de réessayer. Un run annulé pendant l’attente d’un créneau n’est jamais dispatché après sa libération.
- Un succès tardif ne rétablit pas le run ; la publication et son suivi automatique ignorent le run explicitement annulé. Une annulation d’un run déjà terminé laisse son résultat intact.

L’API utilise l’identité et le contrôle d’origine existants et réserve ces actions aux opérateurs autorisés. Les agents isolés n’obtiennent aucune nouvelle clé ni capacité. L’état utilise le journal existant, sans migration. Le modèle de déploiement est inchangé.

## Validation locale

- Moteur : 380 tests dans 38 fichiers avec `vitest run --maxWorkers=2`, puis typecheck. Les six tests ciblés du contrôle et du vrai worker repassent après les derniers correctifs.
- Cockpit : suite serveur, tests HTTP sur socket et vrais processus, 81 tests web, typecheck et build. La CI complète inclut les sauvegardes, leur restauration isolée et la vérification Docker.
- Recette navigateur avec API simulée : pause et reprise, annulation, refus distant visible, absence des boutons pour un utilisateur non autorisé, affichage mobile de 390 px sans débordement ni erreur JavaScript.
- Recette combinée du contrôleur cockpit : commande SQLite, vrai maître, vrai worker, fin effective de l’étape avant acquittement et clôture du run. Aucun modèle réel ou run de production sollicité.

Deux défauts trouvés par les recettes ont été corrigés : le dispatch d’une étape déjà annulée pendant son attente et une transaction imbriquée lors de la clôture d’une étape encore marquée active. Les tests reproduisent ces cas.

## Intégration et production vérifiées

La [PR moteur #105](https://github.com/Raphaelburnier/agent-orchestrator/pull/105) est fusionnée en `8b5178a`, après validation locale du merge courant et accord explicite pour la fusion manuelle. Sa CI n’a pas démarré à cause de la facturation ; elle n’est pas présentée comme réussie. La [PR cockpit #198](https://github.com/Raphaelburnier/business-pipelines/pull/198) est fusionnée en `ffdceba8` après sa [CI complète verte](https://github.com/Raphaelburnier/business-pipelines/actions/runs/40634975928), qui teste ce moteur intégré. Aucun contrôle de fusion n’a été affaibli.

La livraison `3a6a680c-bb75-47c1-abf3-a4703cbebf2e` a terminé avec succès à `2026-10-28T05:14:51.867Z`, release `cockpit-20261028-050456`. Versions : cockpit `ffdceba8`, moteur `8b5178a`, registre `c045d81`.

- Douze sources vérifiées par SHA-256 dans chacun des conteneurs runner, cockpit et maître ; sept services actifs sur les versions attendues.
- API du contrôle accessible à l’opérateur et pause désactivée ; racine et TaskBoard répondent HTTP 200.
- Six tests de contrôle et d’autorisation réussis dans le digest réellement installé, en conteneur jetable sans réseau ni montage de données de production.
- Bouton réel visible sur bureau et mobile de 390 px, sans débordement ni erreur JavaScript. La recette du navigateur ne fait aucune écriture en production.
- Modèle de déploiement approuvé inchangé et conservé. Le lot peut être marqué « fait ».
