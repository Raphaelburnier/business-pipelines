#!/usr/bin/env bash
#
# Publie Vaultwarden sur le tailnet, à lancer sur le NAS.
#
#   nas/vaultwarden/relais.sh          monte le relais sur :8443
#   nas/vaultwarden/relais.sh --stop   le démonte
#   nas/vaultwarden/relais.sh --etat   montre ce qui est publié
#
# Le port 443 appartient déjà au cockpit (bin/tailnet-relais.sh). Vaultwarden prend 8443 :
# un port à lui, donc une origine à lui, et le relais du cockpit n'est pas touché.
set -euo pipefail

PORT_LOCAL=4800
PORT_TAILNET=8443

trouver_tailscale() {
  if command -v tailscale >/dev/null 2>&1; then
    command -v tailscale
    return 0
  fi
  # Paquet Synology : le binaire n'est pas sur le PATH d'une session SSH.
  local syno="/var/packages/Tailscale/target/bin/tailscale"
  if [[ -x "$syno" ]]; then
    printf '%s' "$syno"
    return 0
  fi
  return 1
}

if ! TS="$(trouver_tailscale)"; then
  echo "Tailscale introuvable sur cette machine." >&2
  exit 1
fi

case "${1:-}" in
  --stop)
    "$TS" serve --https="$PORT_TAILNET" off
    echo "Relais démonté. Vaultwarden n'est plus joignable par le tailnet."
    exit 0
    ;;
  --etat)
    "$TS" serve status
    exit 0
    ;;
  "")
    ;;
  *)
    echo "Option inconnue : $1" >&2
    exit 2
    ;;
esac

if ! curl -fsS -o /dev/null "http://127.0.0.1:${PORT_LOCAL}/alive"; then
  echo "Vaultwarden ne répond pas sur 127.0.0.1:${PORT_LOCAL}. Conteneur démarré ?" >&2
  exit 1
fi

"$TS" serve --bg --https="$PORT_TAILNET" "http://127.0.0.1:${PORT_LOCAL}"

NOM="$("$TS" status --json | grep -m1 -oE '"DNSName": "[^"]+"' | cut -d'"' -f4 | sed 's/\.$//')"
echo "Relais monté."
echo "  URL du serveur dans les applis Bitwarden : https://${NOM}:${PORT_TAILNET}"
