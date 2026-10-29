# Lot 4.3 : santé de la plateforme

## Résumé

Rendre les pannes visibles avec une API de santé authentifiée, des sondes Docker bornées et une rotation des journaux de conteneurs. Les signaux distinguent disponibilité des services et avancement métier : un run long, un quota épuisé ou un PC en veille ne sont pas des pannes. Le lot est réservé à cette session ; les alertes 4.2 restent à leur propriétaire. Prochaine étape : valider les recettes et la CI, puis présenter le modèle de déploiement exact avant son approbation.

## Questions d’exploitation

1. Le cockpit et sa base existante sont-ils lisibles, sans créer ou réparer la base pendant une sonde ?
2. Les services répondent-ils encore et leurs signaux de vie sont-ils récents, même pendant un travail long ?
3. Les journaux de services peuvent-ils saturer le disque et comment retrouver un diagnostic sans exposer de secrets ?

## Contrats

- `GET /api/sante` conserve les contrôles d’hôte et d’identité du cockpit. Réponse JSON 200 quand le cœur attendu est disponible, 503 si un contrôle obligatoire manque, expire ou échoue. Champs autorisés : états, codes stables, dates, âge des signaux et versions de code. Aucun chemin privé, identité utilisateur, IP, clé, environnement ou message d’erreur brut.
- `GET /sante` est une sonde interne minimale, accessible par socket Unix ou boucle locale seulement. Elle vérifie la disponibilité locale et renvoie uniquement `{ "ok": boolean }`. Elle n’ouvre aucun autre accès anonyme ; `/api/sante` reste protégé.
- Les services runner, maître, publieur et livreur écrivent un signal de vie atomique dans `etat/sante/`, privé (dossier 0700, fichiers 0600). Un thread dédié émet le signal toutes les 10 secondes et collecte Docker même pendant les opérations Git/tar synchrones du service ; expiration après 45 secondes. Identité d’instance, PID du service et début du processus empêchent de réutiliser un ancien signal après redémarrage. Un arrêt termine le thread puis supprime seulement le signal de cette instance.
- Le livreur lit les états Docker des sept services permanents avec son accès Docker existant, sans le donner au cockpit ni au runner. Il publie une projection limitée, jamais la configuration des conteneurs. Requête bornée à deux secondes, pas de sondes concurrentes ni de remédiation automatique. Le snapshot est lié à l’instance du livreur et expire après 45 secondes.
- Les sondes Docker vérifient leur propre service sans dépendre du verdict global, afin d’éviter une boucle de démarrage. Elles ne lancent ni modèle, ni commande métier, ni reprise. Le maître utilise sa route de santé ; le relais valide le chemin HTTP vers le socket ; whois vérifie son transport local et son socket.
- `json-file` limite les journaux stdout/stderr à 3 fichiers de 10 Mo par conteneur. Les traces de runs et les livrables sont conservés. Aucun outil externe ne modifie les fichiers de journal gérés par Docker.
- Un changement de santé produit un événement JSON borné avec nom stable et identifiant de corrélation. Aucune nouvelle infrastructure de métriques, alerte externe ou dépendance logicielle.

## Validation

Tests Node natifs dans `test/sante-plateforme.test.js` et recette HTTP sur un vrai cockpit : état sain, base absente/corrompue sans création, signaux périmés ou d’une ancienne instance, arrêt/reprise, Docker indisponible, PC absent sans faux positif, refus d’identité et absence de fuite. Vérifier l’expiration et les permissions. Bloquer réellement la boucle principale pendant plus de 45 secondes et vérifier que signal et snapshot Docker restent frais, sans appel modèle. Parser le compose pour vérifier sept sondes et la rétention des huit services, dont le profil manuel.

Commandes : `npm test`, `npm run web:test`, `npm --prefix web run build`, puis construction de l’étage Docker `verification`. Dépendance moteur : installation séparée dans le dépôt voisin (`npm ci`).

## Livraison

Les changements du compose créent une nouvelle empreinte protégée : l’ancien accord ne vaut pas approbation de ce modèle. Après CI et recettes, présenter l’empreinte exacte et les changements pour approbation. Le livreur doit être mis à jour séparément hors livraison active pour publier son état ; ses secrets et droits restent inchangés. Ne passer 4.3 à « fait » qu’après vérification de la version installée, de l’API et des sondes réelles. Aucun redémarrage de production dans les tests.

Références primaires : [sondes Compose](https://docs.docker.com/reference/compose-file/services/#healthcheck), [rotation json-file](https://docs.docker.com/engine/logging/drivers/json-file/).
