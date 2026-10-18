# Identité par socket et commandes signées (F1, F2)

Audit du 17 octobre 2026, lot 0.1 et 0.2.

## Le problème

Le runner tourne en `network_mode: host`, en root, et ses agents ont Bash. Il en découle deux failles.

F1. Un agent peut joindre `127.0.0.1:4600` comme le fait `tailscale serve` et poser lui-même l'en-tête `Tailscale-User-Login`. Le cockpit le croit et signe la décision au nom de Raphaël.

F2. Le runner monte `etat/` en écriture. Une ligne posée directement dans la table `commands` (`github.merge`, `livraison.start`) avait le même pouvoir qu'un clic, puisque le publieur et le livreur ne relisaient que `par` et `canal`.

## La correction

F1 :
- Le cockpit écoute aussi sur un socket Unix (`COCKPIT_SOCKET`), dans `./run-cockpit/`. Le runner ne monte pas ce dossier.
- Avec `COCKPIT_IDENTITE_SOCKET_SEULE=1`, un en-tête d'identité qui arrive par le port TCP est refusé.
- Dans le conteneur, le canal « local » peut lire mais plus écrire. Le contrôle de santé de `deploy.sh` est un GET, il passe toujours.

F2 :
- Le cockpit signe en HMAC-SHA256 `github.merge`, `github.project.attach` et `livraison.start`. La signature couvre l'id, le kind, la charge, `par`, `canal` et l'heure de création.
- Le publieur et le livreur refusent une commande non signée, mal signée ou vieille de plus de 30 minutes.
- La clé vit dans `specs/cles/commandes.key`. Seuls le cockpit, le publieur et le livreur la montent.
- La colonne `sig` vient du moteur (agent-orchestrator, PR « store a cockpit signature with each command »), qui doit donc être livré avec ou avant ce changement.

`github.ci.rerun` et `github.pr.comment` restent non signés : le chat du runner les dépose lui-même. Leur garde est le lot 0.4 (F5).

## Mise en service sur le NAS

Les deux protections restent en mode transition tant que ces étapes ne sont pas faites. Rien ne casse à la livraison, mais rien n'est encore fermé.

1. Livrer les trois dépôts : le moteur avec la colonne `sig`, puis ce cockpit.
2. Créer la clé. Elle ne doit jamais passer par un fichier versionné :
   ```sh
   cd /volume1/docker/business-pipelines
   mkdir -p specs/cles && chmod 700 specs/cles
   head -c 48 /dev/urandom | base64 > specs/cles/commandes.key
   chmod 600 specs/cles/commandes.key
   docker restart business_cockpit business_publieur business_livreur
   ```
   Vérifier dans les journaux du publieur que l'avertissement « COMMANDES_CLE_FICHIER absent » a disparu. Ensuite, faire une fusion de test depuis le cockpit.
3. Faire pointer `tailscale serve` sur le socket. Cela demande une version de Tailscale qui accepte une cible `unix:`, à vérifier sur le paquet DSM :
   ```sh
   tailscale serve --bg unix:/volume1/docker/business-pipelines/run-cockpit/cockpit.sock
   ```
   Ouvrir le cockpit depuis le téléphone et vérifier que l'identité affichée est bien la tienne.
4. Fermer le port TCP à l'identité. Écrire `COCKPIT_IDENTITE_SOCKET_SEULE=1` dans `specs/compose.env`, que `deploy.sh` relit à chaque livraison. Un `.env` à la racine serait effacé. Recréer le cockpit une première fois à la main :
   ```sh
   cd /volume1/docker/business-pipelines
   echo COCKPIT_IDENTITE_SOCKET_SEULE=1 > specs/compose.env
   COCKPIT_IDENTITE_SOCKET_SEULE=1 docker compose up -d --no-build cockpit
   ```
   Vérifier que `curl -H "Tailscale-User-Login: x" http://127.0.0.1:4600/api/approbations` répond 403.

## Retour arrière

- Étape 4 : remettre `COCKPIT_IDENTITE_SOCKET_SEULE=0`.
- Étape 3 : `tailscale serve --bg http://127.0.0.1:4600`.
- Étape 2 : retirer `specs/cles/commandes.key`. Le publieur et le livreur repassent en transition.

## Ce qui reste ouvert

Avec ces protections, un agent du runner ne peut plus signer une fusion ou une livraison. Il peut toujours :
- lire l'event store ;
- déposer des `run.start` et des actions de chat (lot 0.4) ;
- lire les jetons d'abonnement du runner (lot 0.6).

La vraie séparation reste de sortir le runner du réseau hôte, en isolant le maître des workers dans un service sans agents.
