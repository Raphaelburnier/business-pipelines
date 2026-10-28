# Lot 4.5 — sauvegardes de l’état

Résumé : sauvegarder l’état vivant du cockpit hors NAS, sous forme chiffrée sur le PC. Une copie SQLite en ligne, une rétention de 14 sauvegardes réussies et une restauration isolée vérifiée précèdent la clôture du lot. Le rollback des livraisons reste réservé au code.

- Source : `etat/events.sqlite` via l’API SQLite backup (WAL compris), `specs/` complet dont `workers.json`, `approvals/` et `projects/`. Aucun workspace, modèle ou identifiant externe à ces dossiers.
- Export : programme Node exécuté dans le cockpit par le canal SSH existant. Répertoire temporaire privé, refus des liens et fichiers spéciaux, vérification que les fichiers de configuration n’ont pas changé pendant leur copie, manifeste SHA-256 et intégrité SQLite. Aucune donnée sensible dans les journaux.
- Destination : PC, hors volumes NAS ; AES-256-GCM, clé aléatoire locale 0600 séparée des archives. Ni clé ni archive ne va dans Git. Publication atomique uniquement après succès SSH et chiffrement, verrou contre les chevauchements, échéance bornée, statut local lisible sans secret.
- Automatisation : service/timer systemd utilisateur quotidien et persistant, export SSH en lecture seule de l’installation ; aucune modification du modèle de livraison ou des services NAS.
- Rétention : les 14 dernières archives terminées ; un échec conserve les anciennes.
- Restauration : déchiffrement authentifié avant extraction, chemins et types stricts, manifeste et SQLite contrôlés, destination neuve uniquement. Jamais d’écriture dans l’installation vivante pendant la recette.
- Preuves : tests export/WAL, chiffrement altéré ou mauvaise clé refusés, interruption sans publication, rétention, traversée de chemins et liens refusés ; sauvegarde réelle NAS→PC puis restauration isolée et contrôle de l’intégrité et des compteurs SQLite.
- Limite : le PC doit fonctionner pour tirer la sauvegarde. Après indisponibilité, le timer persistant rattrape un passage ; l’âge du dernier succès est dans le statut. Un sinistre simultané NAS/PC n’est pas couvert. La clé doit être conservée séparément pour permettre une récupération après perte du PC.
- Statut : 4.5 et R4 restent `en-cours` jusqu’à la recette et à la livraison du statut final. L’activation du timer et la réussite de la restauration doivent être confirmées, pas supposées.
