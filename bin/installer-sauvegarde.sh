#!/usr/bin/env bash
# Installer sur le PC : bin/installer-sauvegarde.sh utilisateur@nas
set -euo pipefail
[[ $# == 1 && "$1" =~ ^[a-zA-Z0-9_][a-zA-Z0-9_.-]*@[a-zA-Z0-9][a-zA-Z0-9_.-]*$ ]] || { echo 'Usage : installer-sauvegarde.sh utilisateur@nas' >&2; exit 2; }
source_backup="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
installation="$HOME/.local/lib/cockpit-backup"
configuration="$HOME/.config/cockpit-backup"
archives="$HOME/.local/state/cockpit-backup/archives"
umask 077
for outil in node python3 tar flock ssh systemctl; do command -v "$outil" >/dev/null; done
node --no-warnings -e 'if (typeof require("node:sqlite").backup !== "function") process.exit(1)'
systemctl --user is-active default.target >/dev/null
if systemctl --user is-active --quiet sauvegarde-cockpit.service; then echo 'Une sauvegarde est active ; réessayer après sa fin.' >&2; exit 1; fi
mkdir -p "$installation/bin" "$installation/deploy/backup" "$configuration" "$archives" "$HOME/.config/systemd/user"
chmod 700 "$installation" "$configuration" "$archives"
for fichier in bin/sauvegarder-etat.js deploy/backup/exporter-etat.js deploy/backup/verifier-restauration.py; do
  install -m 600 "$source_backup/$fichier" "$installation/$fichier.nouveau"
  mv -f "$installation/$fichier.nouveau" "$installation/$fichier"
done
ln -sfn "$(node -p 'process.execPath')" "$installation/node"
if [[ ! -e "$configuration/cle" ]]; then "$installation/node" "$installation/bin/sauvegarder-etat.js" --initialiser-cle "$configuration/cle"; fi
node - "$configuration/config.json" "$1" "$archives" "$configuration/cle" <<'JS'
const fs = require('node:fs');
const [config, ssh, archives, cle] = process.argv.slice(2);
if (!fs.existsSync(config)) fs.writeFileSync(config, JSON.stringify({ ssh, archives, cle }, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
JS
for unite in sauvegarde-cockpit.service sauvegarde-cockpit.timer; do install -m 644 "$source_backup/deploy/systemd/$unite" "$HOME/.config/systemd/user/$unite"; done
systemctl --user daemon-reload
systemctl --user enable --now sauvegarde-cockpit.timer
# La première sauvegarde est volontairement synchrone : un échec n'est pas présenté comme une installation réussie.
systemctl --user start sauvegarde-cockpit.service
systemctl --user is-enabled sauvegarde-cockpit.timer
"$installation/node" "$installation/bin/sauvegarder-etat.js" --statut
