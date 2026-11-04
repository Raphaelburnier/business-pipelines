# Lot 7.3 — Plan d'implémentation

## Résumé

Le contrat de maintenance v1 de `docs/SPEC-livraison-runs-vivants.md` est approuvé
par Raphaël le 4 novembre 2026 (« je l'accord »). Implémenter d'abord la garantie
atomique du moteur, puis son utilisation par le livreur et le modèle protégé.
La mise en production reste un clic de Raphaël, après les validations distinctes.

## Ordre et vérifications

1. Moteur : schéma strict, état durable et propriétaire ; contrôle du repos et
   acquisition atomique ; réservations et départs CLI protégés. Vérifier avec deux
   connexions réellement concurrentes, réouverture de la base et pause inchangée.
   Pourquoi : les couches de livraison dépendent de cette garantie commune.
2. Cockpit : acquisition après validation de la commande, contrôle avant arrêt,
   libération seulement après issue certaine, récupération opérateur documentée.
   Tester les erreurs avant bascule, restauration et crash sans modèle ni NAS.
   Pourquoi : un redémarrage ne doit pas libérer un verrou dont l'issue est inconnue.
3. Image et migration : `npm ci` pour les deux dépôts, contrôle des composants
   installés, préparation puis activation ; statut 7.3 conservé « en cours ».
   Vérifier les suites serveur/front, typecheck/build et l'image en CI publique.
   Pourquoi : un ancien runner ignore le verrou ; la première installation compte.
4. PR et preuves : publier les changements isolés avec SHA et résultats ; demander
   les approbations sensibles sur le résultat vérifié. Aucun déploiement par l'agent.
   Pourquoi : le contrat approuvé ne remplace pas les contrôles de fusion/production.

Les tâches et leurs statuts sont suivis dans la liste canonique claude-mem
`lot73-livraison-runs-20261104`, sans deuxième liste à synchroniser ici.
