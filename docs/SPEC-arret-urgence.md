# Lot 4.1 — Annuler un run et suspendre les démarrages

## Résumé

Deux contrôles opérateur durables sont livrés et vérifiés le 28 octobre 2026 : annuler un run actif ou en attente, et suspendre puis reprendre globalement les nouveaux démarrages. La pause laisse les runs déjà actifs continuer ; les commandes d’administration et d’annulation restent traitées. L’annulation empêche les reprises et conserve les fichiers ; un arrêt distant non confirmé reste signalé. La recette de l’image installée et la lecture de l’interface réelle passent. Le lot est clos dans la feuille de route ; les opérateurs peuvent utiliser ces contrôles en exploitation.

## Décisions

- La pause concerne les nouveaux runs, les reprises automatiques et les reprises après approbation. Elle ne bloque ni l’enregistrement des décisions, ni les annulations, ni le chat et la livraison.
- Les contrôles arrivent dans une file dédiée au runner, indépendante des longues exécutions. Leur état persiste dans l’event store ; aucun fichier de configuration ou nouvelle table n’est requis.
- Une annulation explicite est définitive pour ce run : ni quota, ni reconnexion, ni redémarrage ne doit le relancer. Les fichiers produits restent conservés. Un nouveau lancement produit un autre run.
- Le runner demande d’abord l’arrêt coopératif de la CLI et des étapes distantes. L’arrêt local est borné et peut forcer le processus récalcitrant. Une étape distante non confirmée est signalée honnêtement ; le système ne prétend pas avoir arrêté un worker injoignable.
- Les routes restent derrière l’identité, le contrôle d’origine et l’autorisation opérateur du cockpit. Les agents de production ne reçoivent aucun nouveau secret ou droit d’écriture dans l’état.
- Les boutons sont disponibles dans le cockpit : contrôle global de la file et annulation dans le détail d’un run. Les anciens consommateurs de l’interface Source restent compatibles.

## Critères de validation

1. Pause puis redémarrage : aucun nouveau run, reprise quota/machine ou reprise après approbation ne démarre ; les annulations et décisions restent traitées.
2. Reprise globale : les commandes déjà en file repartent selon l’ordre existant, sans duplication.
3. Annulation active : la CLI se termine et le worker confirme l’arrêt de ses étapes ; le run est cancelled et n’est plus publié comme réussi.
4. Annulation en attente : la reprise est supprimée ou refusée, l’attente libérée et le run ne revient pas après redémarrage.
5. Rejeu d’une annulation : aucun effet supplémentaire ; un run déjà terminé est conservé.
6. Une déconnexion distante ou un arrêt local non confirmé est visible et n’ouvre aucune reprise automatique.
7. Une écriture anonyme, hors origine ou non autorisée est refusée. Aucun appel modèle réel ni arrêt de production dans les tests.

## Périmètre technique

Moteur : schémas des commandes, état de contrôle durable sans migration, confirmation d’arrêt des étapes distantes et refus de dispatcher une étape annulée pendant son attente de créneau. Cockpit : contrôleur, file d’administration, API et boutons dans l’interface. Ce lot ne modifie pas le modèle Docker de déploiement. La correction du parent du socket de la PR #194, déjà intégrée, est conservée.

## Vérifications prévues

Tests unitaires du contrôle durable et des schémas ; vrais processus et worker simulé déterministe ; tests HTTP d’autorisation ; tests UI d’action et d’état ; suites serveur, moteur, typecheck et build web pertinents. Le statut de la feuille ne passe à fait qu’après vérification de production.
