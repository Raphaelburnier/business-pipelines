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

## Correction du parcours complet — 6 novembre 2026

Résumé : le catalogue exécutable existant décide de l’éligibilité de tous les gestes.
La feuille de route reste visible et distincte de l’avancement des exécutions.
Cette correction est autorisée par la demande de Raphaël de réaliser le chantier
dans l’ordre présenté après l’audit du 6 novembre. Aucun nouveau protocole moteur.

- Une tâche absente du catalogue ne propose ni poignée ni commande de planification ;
  elle explique que son plan reste à préparer. Pourquoi : afficher un geste ensuite
  refusé fait croire à une panne du calendrier.
- Chaque tâche admissible propose aussi un bouton Planifier ouvrant le même formulaire
  pour aujourd’hui, avec sa date modifiable. Pourquoi : le geste souris n’est pas
  disponible sur tous les appareils et n’est pas une condition pour lancer du travail.
- Les dépôts sélectionnés indisponibles sont nommés ; aucun n’est retiré silencieusement
  avant la proposition. Pourquoi : un plan partiel ne réalise pas l’objectif annoncé.
- Le suivi utilise les API existantes des objectifs, des runs et des reprises.
  La date de reprise, sa raison et son éventuelle commande restent celles du moteur.
- Un succès de run ne clôture jamais le lot dans la feuille de route : les contrôles,
  la fusion et la livraison sont des étapes distinctes à vérifier. Le suivi d'activité
  affiche « en cours » jusqu'à cette clôture (précision du 12 novembre dans
  `SPEC-taskboard.md`). Pourquoi : le badge doit montrer le travail engagé sans
  annoncer une validation qui n'a pas encore eu lieu.

Vérification : tests React des interactions admissibles et du suivi, tests serveur
des quotas et parcours Chromium sur base temporaire, avec vrais gestes souris et
formulaire sans glissement. Aucun fournisseur payant ni donnée de production modifiée.
