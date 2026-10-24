# Lot 11 — attribution dans TaskBoard

Résumé : supprimer le renommage 11.1, intégrer le choix des agents et la sensibilité obligatoire côté serveur. Le toggle prioritaire et la planification existants restent utilisables. Prochaine étape : vérification ciblée puis intégration aux branches TaskBoard.

- 11.1 est retiré de la feuille et du catalogue ; le nom retenu est TaskBoard.
- 11.2 : après la première proposition, sélectionner un membre compatible pour chaque rôle agent/revue, ou laisser le choix automatique. Recalculer et relire le plan avant lancement. Un choix explicite incompatible, inconnu, indisponible, affecté ailleurs, au budget épuisé ou auteur de sa propre revue bloque le plan ; aucun repli silencieux. Le contrat conserve le membre et son modèle réel.
- 11.4 : le serveur déduit les risques du catalogue de fichiers annoncé et de la politique partagée. Le client peut demander une revue supplémentaire, jamais supprimer un risque automatique. Exiger une revue sécurité active et un critère de vérification des contrôles d’accès, entrées invalides et non-régression, jugé par les étapes de vérification/revue existantes. La revue et les critères sont conservés dans le contrat. Le gate de fusion contrôle toujours le diff réel.
- Les choix sont couverts par l’empreinte présentée et l’idempotence. Ils s’appliquent aussi à un départ planifié.
- Les anciens travaux TaskBoard 12.2 et quota 2.8 restent dans leurs branches respectives. Ce lot ne modifie ni les limites de quota ni la continuité à minuit.
