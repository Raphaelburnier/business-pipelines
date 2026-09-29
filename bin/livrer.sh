#!/usr/bin/env bash
#
# Livre le cockpit sur le NAS en une commande, depuis le PC.
#
#   bin/livrer.sh              construit, dépose, puis déploie (mot de passe sudo du NAS)
#   bin/livrer.sh --preparer   construit et dépose, sans déployer
#   bin/livrer.sh --local      construit l'archive ici seulement
#   bin/livrer.sh --oui        sans question de confirmation
#   bin/livrer.sh --forcer     même si la production est déjà à jour
#
# Une release est l'export exact de trois têtes de branche, jamais d'un dossier de travail :
# business-pipelines (origin/main), le moteur agent-orchestrator (origin/master) dans
# .moteur, et le registre agent-registry (origin/main). Un fichier non commité ne peut donc
# pas partir en production par accident. Le front se construit, et les tests tournent, dans
# l'image sur le NAS : une release qui ne passe pas ses tests s'arrête avant la bascule.
#
# Le NAS n'a pas git : l'archive y arrive par SSH, avec un deploy.sh tiré de
# deploy/nas/deploy.sh.modele. C'est lui qui sauvegarde, bascule et restaure en cas
# d'échec. Seule sa dernière étape demande sudo, donc le mot de passe, et c'est voulu : les
# agents fusionnent sans relecture humaine, la mise en production reste une décision.
set -euo pipefail

NAS="${NAS:-admindunas@192.168.1.18}"
BUSINESS=/volume1/docker/business-pipelines
RELEASES=/volume1/docker/releases

RACINE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# Les dépôts voisins se trouvent à côté du dépôt principal, pas à côté d'un worktree.
PRINCIPAL="$(dirname "$(git -C "$RACINE" rev-parse --path-format=absolute --git-common-dir)")"
MOTEUR="${MOTEUR:-$(dirname "$PRINCIPAL")/agent-orchestrator}"
REGISTRE="${REGISTRE:-$(dirname "$PRINCIPAL")/agent-registry}"

mode=deployer
oui=0
forcer=0
for argument in "$@"; do
  case "$argument" in
    --preparer) mode=preparer ;;
    --local) mode=local ;;
    --oui) oui=1 ;;
    --forcer) forcer=1 ;;
    -h | --help) sed -n '3,9p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Option inconnue : $argument" >&2; exit 2 ;;
  esac
done

etape() { printf '\n\033[1;33m» %s\033[0m\n' "$*"; }
arreter() { echo "Arrêt : $*" >&2; exit 1; }

for depot in "$RACINE" "$MOTEUR" "$REGISTRE"; do
  [[ -d "$depot/.git" || -f "$depot/.git" ]] || arreter "dépôt introuvable : $depot (MOTEUR= et REGISTRE= pour les indiquer)"
done

etape "Lecture des têtes de branche"
git -C "$RACINE" fetch -q origin main
git -C "$MOTEUR" fetch -q origin master
git -C "$REGISTRE" fetch -q origin main
cockpit="$(git -C "$RACINE" rev-parse --short=7 origin/main)"
moteur="$(git -C "$MOTEUR" rev-parse --short=7 origin/master)"
registre="$(git -C "$REGISTRE" rev-parse --short=7 origin/main)"
version="cockpit $cockpit · moteur $moteur · registre $registre"
echo "À livrer : $version"

if [[ "$mode" != local ]]; then
  etape "État du NAS"
  # Un volume passé en lecture seule (disques retirés à chaud, le 2026-09-28) ferait
  # échouer le dépôt à mi-chemin : mieux vaut le dire avant de construire quoi que ce soit.
  # `ssh -n` partout où rien n'est envoyé : sans lui, ssh avalerait l'entrée standard, et
  # avec elle la réponse à la question de confirmation plus bas.
  montage="$(ssh -n -o BatchMode=yes -o ConnectTimeout=10 "$NAS" "grep ' /volume1 ' /proc/mounts" || true)"
  [[ -n "$montage" ]] || arreter "NAS injoignable, ou /volume1 absent"
  [[ "$montage" == *" rw,"* ]] || arreter "/volume1 est en lecture seule sur le NAS : vérifier le stockage dans DSM"

  en_production="$(ssh -n -o BatchMode=yes "$NAS" "cat $BUSINESS/.release 2>/dev/null" || true)"
  cockpit_prod="$(sed -n 's/^cockpit=//p' <<<"$en_production")"
  moteur_prod="$(sed -n 's/^moteur=//p' <<<"$en_production")"
  registre_prod="$(sed -n 's/^registre=//p' <<<"$en_production")"
  if [[ -z "$cockpit_prod" ]]; then
    echo "En production : inconnu (release antérieure à bin/livrer.sh)"
  else
    echo "En production : cockpit $cockpit_prod · moteur $moteur_prod · registre $registre_prod"
    if [[ "$cockpit_prod $moteur_prod $registre_prod" == "$cockpit $moteur $registre" && "$forcer" -eq 0 ]]; then
      echo "La production est déjà à jour. Rien à livrer (--forcer pour relivrer)."
      exit 0
    fi
    for ligne in "cockpit:$RACINE:$cockpit_prod:origin/main" "moteur:$MOTEUR:$moteur_prod:origin/master" "registre:$REGISTRE:$registre_prod:origin/main"; do
      IFS=: read -r nom depot avant ref <<<"$ligne"
      if git -C "$depot" cat-file -e "$avant^{commit}" 2>/dev/null; then
        journal="$(git -C "$depot" log --oneline --no-merges "$avant..$ref")"
        if [[ -n "$journal" ]]; then
          echo
          echo "Nouveau dans $nom :"
          sed 's/^/  /' <<<"$journal"
        fi
      fi
    done
  fi
fi

etape "Construction de la release"
travail="$(mktemp -d)"
trap 'rm -rf "$travail"' EXIT
stage="$travail/business-pipelines"
mkdir -p "$stage/.moteur" "$stage/agent-registry"
git -C "$RACINE" archive origin/main | tar -x -C "$stage"
git -C "$MOTEUR" archive origin/master | tar -x -C "$stage/.moteur"
git -C "$REGISTRE" archive origin/main | tar -x -C "$stage/agent-registry"

# Ce fichier suit l'archive jusque dans le dossier du cockpit : la prochaine livraison le
# relit pour dire ce qui tourne et ce qui va changer.
cat >"$stage/.release" <<EOF
cockpit=$cockpit
moteur=$moteur
registre=$registre
construite=$(date -Iseconds)
EOF

release="cockpit-$(date +%Y%m%d-%H%M%S)"
archive="business-cockpit-$cockpit-$moteur-$registre.tar.gz"
tar -czf "$travail/$archive" --owner=1000 --group=1000 --numeric-owner -C "$stage" .
empreinte="$(sha256sum "$travail/$archive" | cut -d' ' -f1)"
sed -e "s|@RELEASE@|$release|g" -e "s|@ARCHIVE@|$archive|g" -e "s|@SHA256@|$empreinte|g" -e "s|@VERSION@|$version|g" \
  "$RACINE/deploy/nas/deploy.sh.modele" >"$travail/deploy.sh"
if grep -q '@[A-Z0-9]*@' "$travail/deploy.sh"; then arreter "deploy.sh contient encore un champ non rempli"; fi
sh -n "$travail/deploy.sh" || arreter "deploy.sh généré invalide"
echo "Archive : $archive ($(du -h "$travail/$archive" | cut -f1)), empreinte $empreinte"

if [[ "$mode" == local ]]; then
  sortie="${SORTIE:-$HOME/releases}/$release"
  mkdir -p "$sortie"
  cp "$travail/$archive" "$travail/deploy.sh" "$sortie/"
  echo "Release gardée dans $sortie"
  exit 0
fi

if [[ "$oui" -eq 0 ]]; then
  echo
  question="Déposer la release $release sur le NAS"
  [[ "$mode" == deployer ]] && question="$question et la déployer"
  read -r -p "$question ? [o/N] " reponse || reponse=""
  if [[ ! "$reponse" =~ ^[oOyY]$ ]]; then
    echo "Abandon, rien n'a été envoyé."
    exit 0
  fi
fi

etape "Dépôt sur le NAS ($RELEASES/$release)"
cible="$RELEASES/$release"
ssh -n -o BatchMode=yes "$NAS" "umask 077 && mkdir -p '$cible'"
ssh -o BatchMode=yes "$NAS" "cat > '$cible/$archive'" <"$travail/$archive"
ssh -o BatchMode=yes "$NAS" "cat > '$cible/deploy.sh' && chmod 700 '$cible/deploy.sh'" <"$travail/deploy.sh"
distante="$(ssh -n -o BatchMode=yes "$NAS" "sha256sum '$cible/$archive'" | cut -d' ' -f1)"
[[ "$distante" == "$empreinte" ]] || arreter "empreinte différente sur le NAS ($distante), rien n'a été déployé"
echo "Déposée et vérifiée."

if [[ "$mode" == preparer ]]; then
  echo
  echo "Pour déployer :"
  echo "  ssh -t $NAS 'sudo sh $cible/deploy.sh'"
  exit 0
fi

etape "Déploiement (mot de passe sudo du NAS)"
ssh -t "$NAS" "sudo sh '$cible/deploy.sh'"
echo
echo "Livré : $version"
