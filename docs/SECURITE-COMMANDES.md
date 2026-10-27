# Identité par socket et commandes signées (F1, F2)

## Résumé

Le lot 0.1 sépare le runner et ses agents du réseau hôte. Un maître sans agents conserve les connexions des workers et un relais local transmet l'accès Tailscale au socket Unix du cockpit. Les commandes d'autorité restent signées. Le nouveau modèle doit être fusionné et approuvé explicitement, puis livré et vérifié avant de déclarer F1 terminé en production.

## Frontière d'identité — F1

Le runner utilisait le réseau hôte et pouvait joindre la même boucle locale que `tailscale serve`. Un en-tête `Tailscale-User-Login` fabriqué y était encore accepté tant que le mode socket seul restait désactivé.

Le montage du lot 0.1 ferme ces deux chemins :

- Le runner utilise son réseau Docker `execution`, distinct du réseau `business` du cockpit. Il n'écoute aucun port sur le NAS et ne monte ni le socket du cockpit, ni LocalAPI Tailscale, ni le registre des workers.
- `maitre` conserve l'écoute sur l'adresse Tailscale configurée et le port réservé inférieur à 1024 (F6). Ce service n'exécute aucun agent. Le relais whois lui fournit toujours l'identité de la vraie connexion, en plus du jeton vérifié par le moteur.
- Les étapes empruntent la file durable existante entre le runner et le maître (`MaitreDistant`). La capacité et la disponibilité viennent d'une sonde du maître : une connexion non prête, une étape déjà annoncée, une déconnexion ou une sonde périmée n'autorise pas une reprise.
- `cockpit-relais` écoute seulement `127.0.0.1:4600` sur le NAS et relaie HTTP et SSE vers le socket Unix. Il n'a aucun agent, secret de modèle ou accès à Docker. Son seul montage est `run-cockpit/` en lecture seule ; son code appartient au modèle protégé `deploy/nas`.
- Après le changement global de propriétaire du code, le déploiement réserve `run-cockpit/` à `root:root` en mode `700`. Le relais root sans capacités peut ainsi traverser ce dossier ; le socket créé par le cockpit reste privé en `600`. Un dossier `700` appartenant au compte du NAS bloque ce relais avec `EACCES` et provoque un HTTP 502.
- Le cockpit ne publie plus de port. `COCKPIT_IDENTITE_SOCKET_SEULE=1` y est imposé : un en-tête d'identité arrivé par TCP interne est refusé. Le canal local conserve uniquement les lectures de santé.

Tailscale garde sa cible TCP locale actuelle. Cela fonctionne aussi sur les anciennes versions DSM qui ne prennent pas en charge une cible Unix. Les autres routes du relais Tailscale sont conservées.

Une simple publication de port du maître dans un réseau bridge a été écartée : la recette sur le NAS a montré que son proxy Docker masquait l'adresse réelle du worker. Aucun en-tête fourni par le worker ne remplace cette preuve.

## Signature des commandes — F2

Le cockpit signe en HMAC-SHA256 `github.merge`, `github.project.attach`, `livraison.start`, `github.ci.rerun` et `chat.respond`. La signature couvre l'id, le kind, la charge, l'auteur, le canal et la date.

Le publieur et le livreur refusent une signature absente, invalide ou vieille de plus de 30 minutes. L'id sert de nonce et ne peut être rejoué. Les commandes antérieures au démarrage du consommateur sont refusées. La clé reste montée seulement dans les services d'autorité, jamais dans le runner.

Les actions du chat citent leur question signée d'origine ; le publieur exige une question fraîche du même auteur et du même canal et limite ses actions à cinq. La protection du modèle après lecture de contenu non fiable relève aussi du lot 0.4.

## Activation et recette

1. Faire passer les tests, puis fusionner explicitement la PR : elle modifie Docker et le modèle de déploiement.
2. Examiner l'empreinte et approuver le nouveau modèle selon `docs/SPEC-modele-livraison-approuve.md`. Une ancienne approbation n'autorise pas ce changement.
3. Livrer par la procédure habituelle. Les nouvelles images incluent les services `maitre` et `cockpit-relais` ; la bascule attend leur santé, y compris la réponse du maître vue depuis le runner.
4. Vérifier le réseau réellement exécuté, le refus d'une fausse identité par TCP, l'identité du navigateur à travers Tailscale et la reconnexion du worker. Aucun changement de jeton ni appel de modèle n'est nécessaire à cette recette.

Le script sauvegarde les images des nouveaux services lorsqu'ils existent. Son retour arrière remet aussi une ancienne installation à quatre services lors de la première migration, sans laisser un nouveau relais occuper le port du cockpit restauré. Les configurations durables ne sont pas réécrites.

## Limites conservées

L'administrateur du NAS garde l'autorité sur les processus locaux. L'isolation réseau ne remplace pas l'uid des agents et les permissions du lot 0.6. Le jeton Claude dans l'environnement de la CLI reste le sujet F14 ; cette séparation ne le déclare pas résolu.
