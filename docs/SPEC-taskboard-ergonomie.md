# TaskBoard — commandes et lisibilité

Résumé : rendre visibles les interactions de planification et permettre de choisir les agents dès l’attribution. Regrouper les filtres dans des menus déroulants, afficher les équipes sur les tâches et ordonner les lots par numéro croissant. Valider le parcours avec de vrais gestes de souris avant livraison.

## Organisation

Conserver les couleurs et les polices du cockpit : surfaces sombres, accent existant, titres en sans-serif et données compactes en monospace. Le calendrier reste visible pendant le défilement de la liste, qui occupe une colonne élargie. Les filtres prennent deux rangées au lieu de multiples rangées de boutons ; sur mobile, ils s’empilent.

Les lots suivent les numéros croissants par défaut. L’ordre décroissant et l’ordre conseillé restent disponibles. Les descriptions et fichiers ne doivent pas masquer les commandes. Une tâche système planifiée reste une seule entrée dans la liste ; ses départs sont visibles au calendrier.

## Interactions

- Une poignée « Glisser » identifie les tâches planifiables. Pendant le geste, les jours montrent « Déposer ici » et la cible est soulignée. Les champs et boutons de formulaire n’initient pas de déplacement. Les départs déjà lancés ne proposent pas un nouveau lancement par glissement.
- Le parcours sans glissement reste accessible, notamment sur mobile.
- Le formulaire Attribuer propose les agents compatibles avant le calcul du plan. Le choix automatique reste possible. Tout changement après calcul invalide la validation jusqu’au recalcul.
- Les options Sensible et Run prioritaire ont un libellé visible associé au contrôle ; la revue de sécurité imposée par le serveur reste obligatoire.
- Afficher les agents de la mission figée avec photo ou initiales et nom. Le rôle est indiqué au survol. Une tâche sans attribution l’annonce explicitement. Ne pas déduire ses responsables de la seule équipe du projet.

## Preuves attendues

Parcours sur API et base temporaires, sans lancer de fournisseur : choisir les agents avant le plan et vérifier la demande, modifier puis recalculer, déplacer depuis la poignée avec la souris et observer les repères de dépôt, valider la planification et retrouver ses agents, déplacer la carte au calendrier, contrôler les menus et l’ordre des lots, puis le mobile. Vérifier que la projection des participants n’expose ni contexte ni configuration de mission.
