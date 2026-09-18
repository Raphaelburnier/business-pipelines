#!/usr/bin/env bash
#
# Dépose le moteur dans le contexte de build, avant `docker compose build`.
#
# package.json déclare agent-orchestrator en `file:../agent-orchestrator`. Un contexte de
# build Docker ne remonte jamais au-dessus de sa racine, donc npm ne le trouverait pas, et
# l'installation échouerait. Prendre le dossier parent comme contexte réglerait le chemin
# mais enverrait 6,7 Go au démon pour 340 Ko utiles.
set -euo pipefail

RACINE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MOTEUR="${MOTEUR:-$RACINE/../agent-orchestrator}"

if [[ ! -f "$MOTEUR/package.json" ]]; then
  echo "Moteur introuvable : $MOTEUR" >&2
  echo "Cloner agent-orchestrator à côté de ce dépôt, ou pointer MOTEUR dessus." >&2
  exit 1
fi

rm -rf "$RACINE/.moteur"
mkdir -p "$RACINE/.moteur"
tar -C "$MOTEUR" --exclude=node_modules --exclude=.git -cf - . | tar -C "$RACINE/.moteur" -xf -

echo "Moteur déposé dans .moteur ($(du -sh "$RACINE/.moteur" | cut -f1))"

# Le front est construit ici, pas dans l'image : le build demande 200 Mo de dépendances et
# un conteneur qui les installerait à chaque build coûterait plusieurs minutes pour un
# résultat identique. Ce qui entre dans l'image, c'est web/dist.
if [[ ! -f "$RACINE/web/dist/index.html" || -n "$(find "$RACINE/web/src" -newer "$RACINE/web/dist/index.html" 2>/dev/null)" ]]; then
  echo "Construction du front…"
  npm --prefix "$RACINE/web" ci --silent
  npm --prefix "$RACINE/web" run build --silent
fi
echo "Front prêt dans web/dist ($(du -sh "$RACINE/web/dist" | cut -f1))"
echo "Puis : docker compose build && docker compose up -d"
