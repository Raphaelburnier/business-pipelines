#!/usr/bin/env bash
#
# Installe le cockpit comme service utilisateur systemd, pour qu'il soit debout sans
# qu'on y pense. Sans lui, une alerte reçue à l'extérieur mène à une page qui ne répond
# pas, parce que le relais Tailscale n'a rien vers quoi relayer.
#
#   bin/installer-service.sh                installe, active, démarre
#   bin/installer-service.sh --desinstaller arrête, désactive, supprime
#   bin/installer-service.sh --journal      suit les logs
#
# Un service UTILISATEUR et pas système, délibérément : le cockpit lit et écrit des
# fichiers qui appartiennent à cet utilisateur, et rien dans ce qu'il fait ne demande
# des droits de root. Un service système tournerait avec plus de pouvoir que nécessaire
# pour servir une page sur la boucle locale.
set -euo pipefail

NOM="cockpit-approbation"
RACINE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UNIT="$HOME/.config/systemd/user/${NOM}.service"

case "${1:-}" in
  --desinstaller)
    systemctl --user disable --now "$NOM" 2>/dev/null || true
    rm -f "$UNIT"
    systemctl --user daemon-reload
    echo "Service supprimé. Le cockpit ne redémarrera plus tout seul."
    exit 0
    ;;
  --journal)
    exec journalctl --user -u "$NOM" -f
    ;;
  "") ;;
  *) echo "Option inconnue : $1" >&2; exit 2 ;;
esac

# Le chemin absolu de node, résolu maintenant : systemd ne charge pas le profil du shell,
# donc un `node` trouvé par le PATH interactif ne sera pas trouvé au démarrage.
NODE="$(command -v node || true)"
if [[ -z "$NODE" ]]; then
  echo "node introuvable dans le PATH." >&2
  exit 1
fi

mkdir -p "$(dirname "$UNIT")"
cat > "$UNIT" <<UNITE
[Unit]
Description=Cockpit d'approbation business-pipelines
Documentation=file://${RACINE}/README.md
After=network.target

[Service]
Type=simple
WorkingDirectory=${RACINE}
ExecStart=${NODE} ${RACINE}/bin/cockpit.js
Restart=always
RestartSec=3

# Le cockpit n'écoute que sur la boucle locale et Tailscale relaie vers lui. Il n'y a
# donc rien à ouvrir ici. Le durcissement s'arrête à ce qui ne le gêne pas : il doit
# lire specs/ et écrire approvals/, tous deux dans le dépôt.
NoNewPrivileges=true

[Install]
WantedBy=default.target
UNITE

systemctl --user daemon-reload
systemctl --user enable --now "$NOM"

# Sans « linger », les services utilisateur s'arrêtent à la fermeture de la session. Le
# cockpit doit survivre à la fermeture du terminal, sinon il n'est debout que quand on
# est déjà devant la machine, ce qui est exactement le cas où on n'en a pas besoin.
if [[ "$(loginctl show-user "$USER" -p Linger --value 2>/dev/null || echo no)" != "yes" ]]; then
  echo
  echo "ATTENTION : « linger » est désactivé pour cet utilisateur."
  echo "Le service s'arrêtera à la fermeture de ta session. Pour le garder debout :"
  echo "  sudo loginctl enable-linger $USER"
fi

echo
systemctl --user --no-pager status "$NOM" | head -6
echo
echo "Journal : bin/installer-service.sh --journal"
