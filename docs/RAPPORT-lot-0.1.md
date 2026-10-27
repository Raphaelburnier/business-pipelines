# Lot 0.1 — Isolation réseau du runner

## Résumé

Le lot 0.1 est livré et vérifié en production. Le runner est séparé du réseau hôte et du réseau du cockpit ; le maître des workers est un service sans agents et l’identité du cockpit passe par son socket Unix. La livraison conjointe avec le lot 0.6 a réussi le 26 octobre ; la recette en lecture a été répétée le 27 octobre. F1 et 0.1 sont clôturés. La suite de la feuille est le lot 4.1 : annulation d’un run et pause globale des démarrages.

## État vérifié avant correction

Le runner utilisait encore le réseau hôte et le cockpit acceptait l'identité par TCP. Une lecture de contrôle avec un en-tête fabriqué était acceptée. Aucune commande d'écriture n'a été créée pour cette vérification.

Les protections déjà livrées sont conservées : signature des commandes, uid dédié des agents, port maître réservé et identité Tailscale plus jeton des workers. Le changement n'exige aucune modification du moteur privé ni du worker.

## Choix technique

La recette d'une publication bridge sur l'environnement cible a montré que le maître ne recevait plus l'adresse réelle du worker. Le maître garde donc son propre service sur le réseau hôte et n'exécute aucun agent. Le runner isolé utilise la file SQLite existante pour les étapes. Sa sonde du maître conserve la capacité des workers occupés et exige une disponibilité réellement confirmée pour reprendre un run.

Le relais cockpit écoute seulement la boucle locale. Son seul montage est le socket Unix en lecture seule ; il n'a ni agent, ni configuration secrète, ni accès à Docker. Son code est inclus dans le modèle protégé. Le cockpit ne publie plus de port et refuse toujours l'identité sur son TCP interne.

## Validation

- Suite serveur complète, tests web, vérification TypeScript et build web.
- HTTP : méthode, hôte, identité, origine, corps et statut conservés par le relais ; SSE transmis avant clôture et connexion amont libérée à la déconnexion ; socket absent donnant 502.
- Maître : sonde incompatible, échouée ou périmée fermant la disponibilité ; capacité parallèle conservée pour un worker occupé ; état prêt et étapes annoncées respectés.
- Processus maître distinct, vrai worker et vrai protocole WebSocket : une étape traverse la file SQLite et son résultat revient. L'environnement du run n'est pas enregistré dans cette file.
- Vrai runner : reprise du même run et contrat après redémarrage, avec le maître intégré puis avec le maître séparé, sans rejouer le script réussi ni ouvrir un second maître.
- Script réel de déploiement avec Docker simulé : première migration, installation déjà isolée, maître malade, création partielle, retour arrière, délais et interruption des descendants.
- Conteneurs jetables sur le NAS, sans montage de secrets ni de données de production : identité par socket acceptée, fausse identité TCP refusée, réseau du cockpit et boucle locale inaccessibles depuis l'uid d'agent ; santé maître toujours joignable. Conteneurs et réseaux de recette retirés.
- Configuration Compose validée par la version Docker de l'environnement cible avec fichiers de configuration factices.

Les preuves détaillées restent dans le dossier local de recette. Aucun appel à un modèle ni run métier de production n'est nécessaire.

## Livraison et clôture

La PR #191 a été fusionnée explicitement. Le modèle a été approuvé par l’opérateur et livré conjointement avec le lot 0.6. La première tentative a été restaurée après un défaut de traversée du dossier parent du socket ; une correction opérationnelle de ses permissions a permis la relivraison réussie. La pérennisation de cette précondition reste suivie séparément dans la PR #194.

La recette de production confirme les sept services actifs, les réseaux distincts, le socket absent du runner, le cockpit sans port publié et le relais en lecture seule sans capacités supplémentaires. Sous l’uid d’agent, la boucle locale de l’hôte, le réseau du cockpit et le relais whois sont inaccessibles. Une fausse identité par TCP reçoit 403 ; l’identité réelle via Tailscale reçoit 200. Les contrôles de permissions et de secrets du lot 0.6 restent actifs.

La vérification a été répétée le 27 octobre sans recréer de livraison ni lancer de modèle. Les versions applicatives installées correspondent à la livraison conjointe validée. Les preuves détaillées restent dans les dossiers locaux de recette, sans publication de données d’infrastructure personnelles.
