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
sudo -n /usr/local/bin/docker run --rm -it vaultwarden/server /vaultwarden hash   # hash du jeton admin
cp vaultwarden.env.example vaultwarden.env && chmod 600 vaultwarden.env        # coller le hash
mkdir -p data
sudo -n /usr/local/bin/docker compose up -d
bash relais.sh
```

`sudo` n'est sans mot de passe que pour docker. `relais.sh` appelle `tailscale serve`,
qui n'en a pas besoin si le compte a les droits d'opérateur Tailscale. Sinon, la commande
se lance une fois dans une session avec mot de passe.

## Créer le compte, puis fermer les inscriptions

1. Téléphone connecté à Tailscale. Dans l'appli Bitwarden, choisir « auto-hébergé » et
   saisir `https://nas.tail8296f6.ts.net:8443`, puis créer le compte.
2. Sur le NAS, passer `SIGNUPS_ALLOWED=false` dans `vaultwarden.env`, puis
   `sudo -n /usr/local/bin/docker compose up -d`.
3. Activer la double authentification (TOTP) dans les réglages du coffre.
4. Écrire sur papier le mot de passe maître et le code de récupération 2FA.

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

```bash
sudo -n /usr/local/bin/docker compose pull && sudo -n /usr/local/bin/docker compose up -d
```

## Cockpit

Le cockpit affiche un lien, jamais les mots de passe. Ajouter à
`specs/cockpit-apps.json` sur le NAS l'entrée `vaultwarden` du gabarit.
