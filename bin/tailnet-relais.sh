#!/usr/bin/env bash
#
# Monte le relais qui rend le cockpit joignable depuis le téléphone.
#
#   bin/tailnet-relais.sh          monte le relais
#   bin/tailnet-relais.sh --stop   le démonte
#   bin/tailnet-relais.sh --etat   montre ce qui est publié
#
# Ce que fait le relais, et pourquoi il y en a un plutôt qu'une écoute élargie :
# Tailscale termine le TLS sur un vrai nom, avec un vrai certificat, et relaie vers
# localhost. Le cockpit continue de n'écouter que sur 127.0.0.1. C'est ce qui rend
# fiables les en-têtes d'identité que Tailscale injecte : la documentation de Tailscale
# pose que le service doit rester local, faute de quoi n'importe qui sur le réseau peut
# fabriquer ces en-têtes. Le certificat valide n'est pas un luxe non plus : sans lui,
# pas de service worker, donc pas de notifications push plus tard.
#
# Sous WSL, tailscale tourne côté Windows et le cockpit côté Linux. Le pont existe déjà :
# Windows relaie son localhost vers les sockets en écoute dans WSL. C'est vérifié, pas
# supposé : un serveur lié à 127.0.0.1 dans WSL répond bien à un curl lancé depuis Windows.
set -euo pipefail

PORT="${COCKPIT_PORT:-4600}"
RACINE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Le port peut venir du fichier de configuration comme pour le cockpit lui-même.
if [[ -f "$RACINE/specs/cockpit.env" ]]; then
  DU_FICHIER="$(grep -E '^COCKPIT_PORT=' "$RACINE/specs/cockpit.env" | tail -1 | cut -d= -f2- | tr -d '"'"'"' ' || true)"
  [[ -n "${DU_FICHIER:-}" && -z "${COCKPIT_PORT:-}" ]] && PORT="$DU_FICHIER"
fi

trouver_tailscale() {
  if command -v tailscale >/dev/null 2>&1; then
    command -v tailscale
    return 0
  fi
  # WSL : le démon tourne côté Windows, on parle à son binaire.
  local win="/mnt/c/Program Files/Tailscale/tailscale.exe"
  if [[ -x "$win" ]]; then
    printf '%s' "$win"
    return 0
  fi
  return 1
}

if ! TS="$(trouver_tailscale)"; then
  echo "Tailscale introuvable." >&2
  echo "Sur cette machine : installer Tailscale, puis relancer." >&2
  exit 1
fi

case "${1:-}" in
  --stop)
    "$TS" serve --https=443 off
    echo "Relais démonté. Le cockpit redevient joignable en local seulement."
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

NOM="$("$TS" status --json | grep -m1 -oE '"DNSName": "[^"]+"' | cut -d'"' -f4 | sed 's/\.$//')"
if [[ -z "$NOM" ]]; then
  echo "Impossible de lire le nom de cette machine dans le tailnet. Tailscale est-il connecté ?" >&2
  exit 1
fi

# Le message d'erreur de Tailscale quand la fonction n'est pas activée porte le lien
# d'activation. On le laisse passer tel quel plutôt que de le paraphraser : c'est un lien
# unique à ce tailnet, et le réécrire de mémoire donnerait un lien faux.
if ! SORTIE="$("$TS" serve --bg --https=443 "http://localhost:${PORT}" 2>&1)"; then
  echo "$SORTIE" >&2
  echo >&2
  echo "Le relais n'est pas monté. Si le message ci-dessus parle d'activation, c'est un" >&2
  echo "interrupteur à cocher une fois dans la console d'administration Tailscale." >&2
  exit 1
fi
[[ -n "$SORTIE" ]] && echo "$SORTIE"

echo "Relais monté."
echo "  depuis le téléphone : https://${NOM}"
echo "  vers                : http://localhost:${PORT}"
echo
echo "À mettre dans specs/cockpit.env pour que le cockpit accepte ce nom :"
echo "  COCKPIT_TAILNET=${NOM}"
