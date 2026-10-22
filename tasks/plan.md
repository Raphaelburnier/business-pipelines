# Plan : pipelines, missions et calendrier

Cadrage et implémentation autorisés le 21/10. Suivi canonique : claude-mem `pipelines-missions-calendrier`.

1. Étendre les contrats du moteur : consigne par étape et file tenant compte de date/source/admissibilité.
2. Stocker et valider les définitions versionnées, construire les missions, créer atomiquement les occurrences datées.
3. Exposer les API derrière les contrôles d’identité et d’origine existants ; intégrer le programmateur au runner.
4. Ajouter le compositeur, les missions libres, le calendrier et les accès depuis les projets.
5. Vérifier les contrats, la persistance, le tri, la reprise, les changements d’heure et les parcours UI ; préparer les PR dans l’ordre moteur puis cockpit.
