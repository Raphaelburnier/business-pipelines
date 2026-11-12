# TaskBoard — lot 12.2

Résumé : réunir les tâches et leur calendrier dans TaskBoard. Une date suffit pour programmer le travail ; les agents exécutent les runs prêts en parallèle selon leur capacité, reprennent après quota et ne s’arrêtent pas à minuit. Avant livraison, vérifier le parcours navigateur, les reprises et la concurrence sur des fournisseurs simulés.

## Parcours

- `/taskboard` remplace les deux entrées À venir et Calendrier. Les anciennes adresses ouvrent le même tableau.
- Calendrier principal, liste intégrée filtrable par projet, type et statut ; vues semaine et mois.
- Déposer un objectif projet ou une tâche système sur une date. Un formulaire offre la même action sans glisser, notamment sur mobile.
- Une journée sans heure est éligible à partir de 00:00 Europe/Zurich, y compris si elle est planifiée le matin même. Les heures explicites restent possibles pour les objectifs projet.
- Déplacer un départ conserve son heure locale. Déplacer un objectif récurrent conserve sa récurrence. Une occurrence déjà démarrée ne peut pas être déplacée.
- Pour une tâche système, proposer les dépôts concernés puis un plan par dépôt. Afficher rôles, agents, critères et avertissements. Tout changement d’agent impose un nouveau calcul et une validation du plan.
- Les plans d’une tâche multi-dépôts sont enregistrés ensemble, dans une seule transaction, après validation de toutes leurs empreintes. Aucun départ partiel. Une tâche réservée apparaît dans la liste et ne peut pas être attribuée deux fois.
- Le serveur vérifie les références et calcule la sensibilité depuis le catalogue de confiance. Le choix manuel peut renforcer la sensibilité. Les garanties du lot 11 restent applicables.

## Exécution

- Mettre les objectifs échus en file sans sérialiser les projets ; lancer plusieurs runs jusqu’à la capacité disponible. Le maître permanent borne aussi les étapes des workers.
- Les lancements et reprises d’un même run partagent un verrou. Une décision d’approbation reste enregistrable pendant les autres runs.
- Aucun arrêt à la fin de la journée : un run actif continue avec son quota. Après épuisement réel, reprendre le même run, sa mission figée, son workspace et sa session à l’échéance fiable du fournisseur. Sans échéance, conserver la fenêtre de prudence de cinq heures du lot 2.8.
- Les reprises après quota des départs calendrier continuent les jours suivants sans plafond de trois tentatives ni expiration de 24 heures. Les attentes de connexion et les départs manuels conservent leurs règles.
- Aucun changement du lot/run 2.6.

## Suivi des statuts

Le suivi demandé le 12 novembre utilise les attributions et les occurrences existantes,
sans nouveau contrat ni écriture dans l'historique. Dès qu'une exécution est en file,
active, en revue ou réussie, sa tâche système affiche « en cours » tant que la feuille
ne la clôture pas. Une programmation future seule ne démarre pas le travail. Un run
échoué ou annulé conserve le statut de la feuille ; un lot déjà fait ne se rouvre pas.
Pourquoi : l'activité doit être visible pour tous les agents, sans confondre succès du
run et validation complète du lot, notamment pour les tâches multi-dépôts.

Un défaut dont le correctif est exactement `Lot N.N` suit automatiquement le statut de
cette étape, y compris ses filtres, compteurs et badge. Les liens absents, multiples ou
en prose gardent leur statut explicite. Un défaut fait quitte les Fix ouverts et reste
consultable dans « Faites » ou « Toutes ». Pourquoi : conserver la trace du défaut sans
faire réattribuer son correctif, ni clôturer un travail sur une référence ambiguë.

Les sessions interactives maintiennent la feuille et les défauts associés dès la prise
en charge, puis après les contrôles de fin. La règle commune est versionnée dans
`agent-registry/shared/AGENTS.md` ; les revues et les agents sans droit d'écriture
signalent les écarts au responsable. Pourquoi : leur activité hors du cockpit ne peut
pas être déduite des occurrences natives. Les fusions sensibles et livraisons conservent
leur approbation et leur circuit humains.

## Quotas et priorité

- Claude : événements `rate_limit_event` du SDK, fraction `utilization`, fenêtres exposées seulement.
- Codex : lecture `account/rateLimits/read` de l’app-server natif, sans création de thread ni appel de modèle. Le worker transmet ses mesures par son journal numéroté ; le NAS peut aussi relever son compte local.
- Une mesure expire après quinze minutes ou au reset de la fenêtre. Ne jamais présenter un budget en dollars comme un quota d’abonnement.
- Si les deux fournisseurs sont connus, prendre le minimum des fenêtres exposées. Strictement sous 25 %, traiter reprises/contrôles, puis nouveaux runs marqués prioritaires, puis les autres en FIFO. À 25 % ou plus, FIFO normal. Aucun run actif n’est interrompu pour cette priorité.
- Si une mesure manque, signaler « inconnu » et conserver l’ordre normal.

## Vérification attendue

API/SQLite : transaction multi-dépôts annulée intégralement en cas d’erreur, déduplication, contrat immuable, déplacement après changement d’heure, date du jour et sensibilité vérifiée serveur. Moteur : seuil strict, ordre des commandes, quota sans appel modèle, transport worker, reprises au-delà de trois tentatives et de minuit. Runner : deux runs réellement simultanés et troisième en attente de capacité. Navigateur : plan système, sélection d’agents et recalcul, calendrier semaine/mois, glisser-déposer, mobile sans débordement. Aucune recette métier payante n’est nécessaire à ces contrôles.
