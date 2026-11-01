#!/usr/bin/env bash
# Métadonnées en Bash : leur coût ne doit pas consommer le budget du scénario
# d'arrêt avant que le vrai processus bloquant soit lancé. Chaque appel reste tracé.
set -eu
json_chaine() {
  local valeur=$1
  valeur=${valeur//\\/\\\\}; valeur=${valeur//\"/\\\"}
  valeur=${valeur//$'\n'/\\n}; valeur=${valeur//$'\r'/\\r}; valeur=${valeur//$'\t'/\\t}
  printf '"%s"' "$valeur"
}
{
  printf '['; separateur=
  for argument in "$@"; do printf '%s' "$separateur"; json_chaine "$argument"; separateur=,; done
  printf ']\n'
} >> "$RECETTE_LOG"
initial=1; phase=0
if [[ -f "$RECETTE_UP" ]]; then initial=0; IFS= read -r phase < "$RECETTE_UP" || true; fi
scenario=$RECETTE_SCENARIO
bloquer() { exec "$RECETTE_NODE" "$RECETTE_BLOQUEUR"; }
case "${1:-}" in
  inspect)
    nom=$2; format=${!#}
    if [[ "$scenario" == creation-partielle && "$phase" == 1 && ( "$nom" == business_runner || "$nom" == business_tailscale_whois ) ]]; then exit 1; fi
    if [[ "$RECETTE_DEJA_ISOLE" != 1 && "$initial" == 1 && ( "$nom" == business_maitre || "$nom" == business_cockpit_relais ) ]]; then exit 1; fi
    if [[ "$nom" == business_alerteur && "$RECETTE_DEJA_ALERTEUR" != 1 && "$initial" == 1 ]]; then exit 1; fi
    if [[ "$scenario" == maitre-malade && "$nom" == business_maitre && "$format" == *'.State'* && "$phase" == 1 ]]; then echo false; exit 0; fi
    if [[ "$scenario" == signal-sante && "$format" == *'.State'* && "$phase" == 1 ]]; then bloquer; fi
    if [[ "$format" == *'.Image'* ]]; then printf 'image-ancienne-%s\n' "$nom"; else echo true; fi
    ;;
  exec)
    if [[ "$2" == business_alerteur && "$scenario" == alerteur-malade && "$phase" == 1 ]]; then exit 1; fi
    ;;
  tag)
    if [[ "$scenario" == phase-epuisee ]]; then /bin/sleep 1; fi
    ;;
  rm)
    for argument in "$@"; do
      if [[ "$RECETTE_DEJA_ISOLE" != 1 && "$initial" == 1 && ( "$argument" == business_maitre || "$argument" == business_cockpit_relais ) ]]; then exit 9; fi
      if [[ "$scenario" == creation-partielle && "$phase" == 1 && ( "$argument" == business_runner || "$argument" == business_tailscale_whois ) ]]; then exit 9; fi
    done
    ;;
  compose)
    case "$2" in
      build)
        case "$scenario" in avant-echec) exit 41 ;; avant-bloque|signal|signal-handshake) bloquer ;; esac
        ;;
      up)
        phase=$((phase + 1)); printf '%s' "$phase" > "$RECETTE_UP"
        code=0
        case "$scenario" in succes|socket-prive|signal-sante|maitre-malade|alerteur-malade) ;; *) if [[ "$phase" == 1 ]]; then code=42; fi ;; esac
        if [[ "$scenario" == socket-prive && "$phase" == 1 ]]; then
          IFS= read -r proprietaire < "$RECETTE_SOCKET_OWNER" || true
          if [[ "$proprietaire" != '0:0' || "$(stat -c %a "$RECETTE_SOCKET_DIR")" != 700 ]]; then
            echo 'EACCES : relais sans capacités, dossier socket privé inaccessible' >&2; code=42
          fi
        fi
        if [[ "$scenario" == signal-apres && "$phase" == 1 ]]; then bloquer; fi
        if [[ "$scenario" == restauration-echec && "$phase" == 2 ]]; then exit 23; fi
        if [[ "$scenario" == restauration-bloquee && "$phase" == 2 ]]; then bloquer; fi
        exit "$code"
        ;;
    esac
    ;;
esac
