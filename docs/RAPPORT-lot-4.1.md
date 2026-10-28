# Lot 4.1 — Pause globale et arrêt d’urgence

## Résumé

Le cockpit dispose d’une pause durable des démarrages et d’une annulation explicite par run. Les runs actifs continuent pendant la pause ; une annulation empêche les reprises, conserve les fichiers et exige une confirmation du travail distant. Les recettes locales passent. L’intégration des deux dépôts et la vérification en production restent à effectuer ; la CI privée du moteur est bloquée avant exécution par la facturation GitHub Actions.

## Comportement livré dans le code

- « Suspendre les démarrages » bloque les nouveaux lancements, le calendrier et les reprises quota, machine ou après approbation. La pause survit au redémarrage ; les décisions, le chat, l’administration et les annulations restent traités.
- « Annuler ce run » pose un marqueur durable, retire les reprises prêtes et arrête sa CLI locale. Après le délai coopératif, les processus Linux récalcitrants et leurs descendants recensés sont arrêtés, en vérifiant leur identité.
- Les étapes distantes passent par la file SQLite et le maître. Un worker injoignable ou un arrêt non confirmé reste visible ; l’interface propose de réessayer. Un run annulé pendant l’attente d’un créneau n’est jamais dispatché après sa libération.
- Un succès tardif ne rétablit pas le run ; la publication et son suivi automatique ignorent le run explicitement annulé. Une annulation d’un run déjà terminé laisse son résultat intact.

L’API utilise l’identité et le contrôle d’origine existants et réserve ces actions aux opérateurs autorisés. Les agents isolés n’obtiennent aucune nouvelle clé ni capacité. L’état utilise le journal existant, sans migration. Le modèle de déploiement est inchangé.

## Validation locale

- Moteur : 380 tests dans 38 fichiers avec `vitest run --maxWorkers=2`, puis typecheck. Les six tests ciblés du contrôle et du vrai worker repassent après les derniers correctifs.
- Cockpit : suite serveur, tests HTTP sur socket et vrais processus, tests web, typecheck et build.
- Recette navigateur avec API simulée : pause et reprise, annulation, refus distant visible, absence des boutons pour un utilisateur non autorisé, affichage mobile de 390 px sans débordement ni erreur JavaScript.
- Recette combinée du contrôleur cockpit : commande SQLite, vrai maître, vrai worker, fin effective de l’étape avant acquittement et clôture du run. Aucun modèle réel ou run de production sollicité.

Deux défauts trouvés par les recettes ont été corrigés : le dispatch d’une étape déjà annulée pendant son attente et une transaction imbriquée lors de la clôture d’une étape encore marquée active. Les tests reproduisent ces cas.

## Intégration attendue

Le cockpit dépend de la [PR moteur #105](https://github.com/Raphaelburnier/agent-orchestrator/pull/105). Sa CI utilise la branche principale du moteur : intégrer le moteur avant de valider la CI finale du cockpit. Les chemins sensibles imposent une fusion explicite ; aucun contrôle de fusion n’a été affaibli. La CI moteur n’est pas présentée comme réussie : elle n’a pas démarré à cause de la facturation.

Après intégration, livrer la paire puis vérifier la présence des contrôles et l’état initial de la pause. Garder le lot 4.1 « en cours » tant que la vérification de production manque.
