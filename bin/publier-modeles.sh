#!/usr/bin/env bash
#
# Relève le catalogue OmniRoute sur le PC et le pousse dans etat/ du cockpit du NAS.
#
#   bin/publier-modeles.sh            relève et pousse
#   bin/publier-modeles.sh --local F  relève dans le fichier F, sans rien pousser
#
# Le cockpit ne joint pas OmniRoute (décision 5 : la passerelle reste sur le PC) et ne
# reçoit aucune clé. C'est donc le PC qui pousse, par la même connexion SSH que le
# déploiement. Une passerelle muette produit quand même un relevé, qui le dit : le cockpit
# affiche « OmniRoute ne répond pas » plutôt qu'une vieille liste. Quand le PC dort, rien
# n'est poussé et le cockpit voit le relevé vieillir.
#
# Variables : MOTEUR (checkout d'agent-orchestrator), NAS_SSH (compte@hôte), NAS_CATALOGUE
# (chemin du fichier sur le NAS). La clé OmniRoute vient de ~/.config/omniroute-client.env.
set -euo pipefail

MOTEUR="${MOTEUR:-$HOME/code/Raphaelburnier/agent-orchestrator}"
NAS_CATALOGUE="${NAS_CATALOGUE:-/volume1/docker/business-pipelines/etat/modeles.json}"

set -a
# shellcheck disable=SC1091
. "$HOME/.config/omniroute-client.env"
set +a

if [[ "${1:-}" == "--local" ]]; then
  node "$MOTEUR/bin/orch.js" modeles --sortie "${2:?chemin attendu}"
  exit
fi

: "${NAS_SSH:?NAS_SSH attendu, par exemple compte@hote}"
releve="$(mktemp)"
trap 'rm -f "$releve"' EXIT
node "$MOTEUR/bin/orch.js" modeles --sortie "$releve" || true
# Écriture puis renommage côté NAS : le cockpit ne lit jamais un fichier à moitié arrivé.
ssh -o BatchMode=yes -o ConnectTimeout=10 "$NAS_SSH" \
  "cat > '$NAS_CATALOGUE.tmp' && mv '$NAS_CATALOGUE.tmp' '$NAS_CATALOGUE'" < "$releve"
