# Lot 4.2 — alertes hors du cockpit

Résumé : consommer les événements durables `alerte`, `run.failed` et le format réellement émis `run.finished` avec `status: failed`, puis notifier Raphaël par le SMTP déjà configuré. Le lot et O1 restent en cours jusqu’à la recette et à la livraison. Le destinataire doit être précisé ; l’ajout du service Docker et sa prise en charge par le modèle de déploiement exigent une approbation opérateur de l’empreinte finale.

## Contrat

- Service `alerteur` autonome sur le NAS, redémarrage automatique, aucun agent ni modèle, aucun port entrant. SQLite des runs monté en lecture seule ; seul le dossier `etat/alertes` est inscriptible. Configuration SMTP JSON privée montée en lecture seule dans ce seul service, sans clé des fournisseurs ni jeton GitHub. UID NAS existant 1026:100, capacités retirées, racine en lecture seule et réseau séparé.
- Lire les événements par pages de 500 en ordre croissant. Le premier démarrage prend la tête courante comme point de départ pour éviter l’envoi de l’historique. Un marqueur d’identité du journal source et le curseur sont conservés ; un remplacement ou recul incohérent de l’event store bloque avec diagnostic, sans notification arbitraire.
- Insérer les notifications et avancer le curseur dans une transaction de la base dédiée, indépendamment du transport. Conserver les messages à envoyer, tentatives, échéances et accusés après redémarrage. Une seule instance traite cette base à la fois (verrou durable avec bail renouvelé ou verrou noyau).
- Déduplication par identité de source et ID d’événement ; répétitions d’alertes machine regroupées par sujet/machine pendant 15 minutes. Un échec de run doit produire une notification même si un autre run du même projet a échoué. Le transport SMTP n’offre pas de transaction avec SQLite : après un arrêt entre acceptation SMTP et journalisation, une répétition reste possible. Utiliser un Message-ID déterministe, sans promettre une livraison exactement une fois.
- Réessayer avec recul borné (1 minute à 1 heure), ne jamais considérer un échec comme envoyé. Un échec n’empêche pas les autres messages de partir. Purger les accusés anciens avec une rétention bornée, conserver les messages non envoyés.
- Messages en texte brut, contexte minimal et liens de lecture vers le cockpit. Ni raison brute d’erreur, ni payload complet, ni secret dans les messages ou les journaux. Aucun lien ne déclenche une décision ou une action.
- SMTP chiffré : TLS implicite au port465, STARTTLS exigé autrement, validation des certificats, connexion et envoi bornés. État de service, retard du curseur, nombre en attente, âge du dernier succès et catégories d’échec consultables localement sans secret. Logs JSON avec événement/corrélation/point d’entrée, sans adresse ni mot de passe.
- Préserver le dossier de notification lors des livraisons et retours arrière. Ajouter le service à la construction, à la bascule, aux contrôles de santé et au nettoyage d’une création partielle ; restaurer l’ancien ensemble de services en cas d’échec. Inclure la base dédiée dans la sauvegarde4.5 lorsqu’elle existe.

## Vérification

Tester avec des bases SQLite réelles et transports contrôlés : première initialisation sans historique, événement ultérieur livré, reprise après panne SMTP et redémarrage, absence de répétition, deux processus concurrents, regroupement des alertes machine, pagination d’un gros journal, changement de source refusé, interruption après envoi, données sensibles non reproduites, et transport qui refuse l’authentification en clair. Tester le vrai modèle de déploiement avec ancien/nouveau service, panne avant/après bascule et restauration ; ne pas altérer les tests de sécurité ou les délais existants pour obtenir du vert.

Une recette native isolée précède l’activation : vrais processus, fichiers temporaires privés, serveur de test contrôlé, aucune panne métier provoquée en production. Vérifier ensuite le destinataire configuré, la remise effective d’une notification de test, l’état du service installé et un second passage sans doublon. La validation externe dépend de la destination précisée par Raphaël.

## Exploitation et limites

Le service fonctionne sans le PC. Un NAS arrêté ou un SMTP indisponible ne peut pas envoyer immédiatement ; les événements persistés repartent au retour. La détection externe de l’indisponibilité complète du NAS relève du lot4.3/monitoring, pas d’un consommateur hébergé sur ce même NAS. Les anciennes alertes d’approbation restent compatibles avec `bin/alerter.js` ; ce lot cible les événements d’exploitation et les échecs de runs.
