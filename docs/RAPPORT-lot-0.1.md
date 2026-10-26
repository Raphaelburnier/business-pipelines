# Lot 0.1 — Isolation réseau du runner

## Résumé

Le correctif sépare le runner qui exécute les agents du réseau hôte et du réseau du cockpit. Le maître des workers devient un service sans agents ; un relais local transmet l'identité Tailscale au socket Unix du cockpit. Les recettes du vrai runner, du vrai protocole worker, des flux SSE, de l'isolation Docker et de la restauration ont été ajoutées. La prochaine étape est la fusion explicite et l'approbation du modèle exact, puis la livraison et la recette finale ; F1 et 0.1 restent « en cours » jusque-là.

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

## Activation restante

Cette PR modifie `docker-compose.yaml` et `deploy/nas/`. Elle exige une fusion explicite et une nouvelle approbation opérateur du modèle, conformément à la politique de livraison. L'ancienne empreinte ne couvre pas ce contenu.

Après autorisation : vérifier les SHA et l'empreinte exacts, livrer, confirmer les six services applicatifs, la reconnexion du worker, l'identité réelle du navigateur et le refus d'accès depuis le runner. Mettre ensuite F1 et 0.1 à « fait ». Le sujet F14 du jeton Claude reste distinct.
