# Vaultwarden sur le NAS

Gestionnaire de mots de passe auto-hébergé, compatible avec les applis Bitwarden.
Joignable seulement par le tailnet, sur `https://nas.tail8296f6.ts.net:8443`.

## Installer

Depuis le PC, envoyer le dossier (sans `data/` ni `vaultwarden.env`) :

```bash
tar -C nas -czf - vaultwarden/docker-compose.yaml vaultwarden/vaultwarden.env.example vaultwarden/relais.sh \
  | ssh admindunas@192.168.1.18 'tar -C /volume1/docker -xzf -'
```

Sur le NAS :

```bash
cd /volume1/docker/vaultwarden
sudo -n /usr/local/bin/docker run --rm -it vaultwarden/server:1.37.4 /vaultwarden hash --preset owasp   # hash du jeton admin
cp vaultwarden.env.example vaultwarden.env && chmod 600 vaultwarden.env        # coller le hash
mkdir -p data
sudo -n /usr/local/bin/docker compose up -d
bash relais.sh
```

`sudo` n'est sans mot de passe que pour docker. `relais.sh` appelle `tailscale serve`,
qui n'en a pas besoin si le compte a les droits d'opérateur Tailscale. Sinon, la commande
se lance une fois dans une session avec mot de passe.

## Créer le compte, puis fermer les inscriptions

Les inscriptions sont fermées dans `docker-compose.yaml` (`SIGNUPS_ALLOWED=false`). Pour
créer un compte :

1. Passer la ligne à `true`, puis `sudo -n /usr/local/bin/docker compose up -d`.
2. Téléphone connecté à Tailscale. Dans l'appli Bitwarden, choisir « auto-hébergé » et
   saisir `https://nas.tail8296f6.ts.net:8443`, puis créer le compte.
3. Remettre `false`, puis `sudo -n /usr/local/bin/docker compose up -d`.
4. Activer la double authentification (TOTP) dans les réglages du coffre.
5. Écrire sur papier le mot de passe maître et le code de récupération 2FA.

Le mot de passe maître ne se récupère pas : le serveur ne l'a jamais eu.

## Sauvegarder

Tout l'état est dans `data/` (base SQLite, pièces jointes, clés du serveur). Le NAS seul
n'est pas une sauvegarde : s'il meurt, le coffre meurt avec.

- Tâche Hyper Backup quotidienne de `/volume1/docker/vaultwarden/data` vers une cible
  hors du NAS (disque USB ou cloud), chiffrée.
- De temps en temps, un export chiffré depuis l'appli (format `.json` chiffré), rangé
  ailleurs. Tester une restauration au moins une fois.

Les applis gardent une copie chiffrée du coffre : Tailscale coupé, on lit toujours ses
mots de passe, on n'en ajoute plus.

## Mettre à jour

L'image est épinglée par tag et digest. Lire les notes de version
(<https://github.com/dani-garcia/vaultwarden/releases>), changer les deux dans
`docker-compose.yaml`, l'envoyer sur le NAS, puis :

```bash
sudo -n /usr/local/bin/docker compose pull && sudo -n /usr/local/bin/docker compose up -d
```

## Passer à la version durcie (F9, F10)

Le NAS tournait en `latest` (1.37.3), inscriptions ouvertes, `IP_HEADER=X-Forwarded-For`.
Depuis le PC, envoyer le compose à côté de l'ancien, puis sur le NAS sauvegarder, remplacer
et relancer. `data/` et `vaultwarden.env` ne bougent pas.

```bash
scp nas/vaultwarden/docker-compose.yaml admindunas@192.168.1.18:/volume1/docker/vaultwarden/docker-compose.yaml.nouveau
ssh admindunas@192.168.1.18
cd /volume1/docker/vaultwarden
tar -czf ~/vaultwarden-avant-durcissement-$(date +%F).tar.gz docker-compose.yaml vaultwarden.env
mv docker-compose.yaml.nouveau docker-compose.yaml
sudo -n /usr/local/bin/docker compose up -d
curl -s http://127.0.0.1:4800/api/version   # "1.37.4"
```

Si `vaultwarden.env` contient encore `SIGNUPS_ALLOWED=true`, la ligne du compose l'emporte ;
la retirer quand même. Puis vérifier dans l'appli que la double authentification est
active sur le compte.

## Cockpit

Le cockpit affiche un lien, jamais les mots de passe. Ajouter à
`specs/cockpit-apps.json` sur le NAS l'entrée `vaultwarden` du gabarit.
