# Lot 0.1 — Isolation réseau du runner

## Résumé

Terminer F1 : le runner quitte le réseau hôte et ne rejoint pas le réseau du cockpit. Un relais local sans agents relie Tailscale au socket Unix du cockpit, qui refuse toute identité reçue par TCP. Un service maître sans agents conserve le réseau hôte, son port réservé et vérifie encore l'identité réelle et le jeton du worker. La prochaine étape est la validation des tests, puis la revue et l'approbation explicites du nouveau modèle de livraison avant activation.

## Existant et objectif

Les commandes d'autorité sont signées et les agents utilisent un uid distinct. Cependant le runner partage encore le réseau hôte, et la configuration livrée laisse l'identité TCP active. Les anciens réglages décrivaient une transition jamais achevée. Le Tailscale installé ne prend pas en charge la cible Unix attendue ; le relais évite une mise à jour de ce service.

## Montage retenu

- `runner` utilise un réseau bridge dédié, distinct de `business`. Aucun socket Docker, Tailscale ou cockpit n'entre dans le runner.
- Le maître permanent devient un service dédié sans agents, sur le réseau hôte. Il lit le registre des workers et conserve son écoute sur la seule adresse Tailscale, à un port inférieur à 1024 (F6). Le relais whois reste sur la boucle locale, sans socket LocalAPI monté dans le maître.
- Le runner transmet les étapes via la file SQLite existante (`MaitreDistant`) ; il sonde la santé du maître pour la capacité et la disponibilité exacte des workers. Une sonde échouée ou périmée bloque les nouveaux lancements et reprises. Le mode intégré reste disponible pour les installations locales et les tests existants.
- Une recette sur le NAS a prouvé que la publication bridge masque l’adresse réelle du worker derrière la passerelle Docker. Ce montage a été écarté : aucune confiance accordée à un en-tête fourni par le worker.
- Le cockpit n'a plus de port TCP publié et exige une identité reçue par son socket Unix. Sa lecture de santé reste possible sans identité.
- `cockpit-relais`, sans agents ni configuration secrète, écoute uniquement la boucle locale de l'hôte et relaie HTTP et SSE vers le socket. Tailscale garde sa cible actuelle. Son code appartient au modèle protégé `deploy/nas`.
- Le déploiement construit une seule image, couvre le nouveau relais dans la santé et la bascule, et restaure aussi une installation ancienne sans relais. Les fichiers de configuration durables et les autres routes Tailscale restent conservés.

## Critères de recette

1. Un agent du runner ne joint ni la boucle locale du NAS ni le socket du cockpit ; un en-tête Tailscale fabriqué par TCP est refusé.
2. L'accès réel du navigateur à travers Tailscale conserve son identité, les écritures légitimes et les flux SSE.
3. Le maître sans agents reçoit toujours la vraie adresse Tailscale ; le worker se reconnecte sans changement de jeton. Sa disponibilité inclut sa connexion, son état prêt et ses étapes déjà en cours.
4. Les échecs avant/après bascule restaurent les anciens services, y compris lors de la première installation du relais.
5. La CI, la suite serveur pertinente, le build web et les recettes Docker passent. La feuille ne passe à « fait » qu'après recette de production.

## Vérifications

`node --test test/cockpit-relais.test.js test/deploiement.test.js`, `node test/acces.test.js`, `npm test`, `npm run web:test`, `npm --prefix web run build`, `sh -n deploy/nas/deploy.sh.modele`. Une sonde Docker sans secrets vérifie le routage avant livraison ; aucun modèle n'est invoqué pour cette recette.

## Limites et autorité

L'isolation protège du code d'agent dans le conteneur ; l'administrateur du NAS conserve l'autorité sur les processus locaux. Le lot 0.6/F14 reste distinct. Les changements Docker et du modèle de déploiement nécessitent une fusion explicite et l'approbation du modèle exact ; la validation du lot ne doit pas être inscrite à leur place.
