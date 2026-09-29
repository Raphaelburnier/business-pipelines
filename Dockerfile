# Version mineure épinglée : le store des approbations utilise `node:sqlite`, disponible sans
# option seulement depuis Node 22.13. Une image `node:22-alpine` plus ancienne restée en cache
# sur le NAS ferait tomber le cockpit au premier accès à la base.
FROM node:22.23-alpine AS base

# Le SDK d'agents lance le CLI Claude Code en sous-processus, et ce CLI embarque un ripgrep
# lié à la glibc. Alpine est sur musl, donc ce binaire ne s'exécute pas. USE_BUILTIN_RIPGREP=0
# le renvoie vers celui du système, installé ici. Sans ça les outils de recherche d'un agent
# échouent un par un, ce qui ressemble à un agent qui ne trouve rien plutôt qu'à une image
# mal construite.
# bash : sans lui, l'outil Bash de Claude Code refuse de démarrer (« No suitable shell
# found ») et un agent ne peut lancer aucune commande, pas même les tests.
RUN apk add --no-cache bash git openssh-client ripgrep
ENV SHELL=/bin/bash
# Les dépôts de projets montés appartiennent à admindunas, le runner tourne en root. Git
# refuse alors de pousser (« dubious ownership »). Les variables GIT_CONFIG_* du compose ne
# suffisent pas : git les efface pour le sous-processus qui reçoit un push local. Seule une
# configuration système ou globale atteint ce sous-processus. Les dossiers de travail des
# runs sont couverts aussi : la bascule les rend à admindunas, et git refusait alors le
# dépôt du run précédent (« not in a git directory », deux runs perdus le 2026-09-26).
RUN git config --system --add safe.directory /git/steam-tierlist.git \
 && git config --system --add safe.directory '/app/workspaces/*'
ENV USE_BUILTIN_RIPGREP=0

WORKDIR /app

# Le moteur est déclaré `file:../agent-orchestrator` dans package.json, donc npm le cherche
# à /agent-orchestrator une fois le travail dans /app. Un contexte de build Docker ne remonte
# jamais au-dessus de sa racine, et prendre le dossier parent comme contexte n'est pas une
# option : il porte 27 projets pour 6,7 Go. bin/preparer-image.sh dépose donc les 340 Ko du
# moteur dans .moteur/ avant le build.
COPY .moteur/ /agent-orchestrator/

# Le moteur installe ses propres dépendances chez lui. npm crée bien le lien symbolique
# pour une dépendance `file:`, mais il n'installe pas l'arbre du paquet lié : le lock de ce
# dépôt ne décrit que les dépendances de ce dépôt. Sans cette ligne,
# /agent-orchestrator/node_modules reste vide, `@anthropic-ai/claude-agent-sdk` est
# introuvable, et le premier appel d'agent meurt en ERR_MODULE_NOT_FOUND. Une fois par
# réveil, toutes les quinze minutes, sans que la boucle avance jamais.
RUN cd /agent-orchestrator && npm install --omit=dev

# Les dépendances avant le code : une modification du code ne réinstalle alors rien.
COPY package*.json ./
RUN npm install --omit=dev

# ---- Vérification : le front se construit et les tests passent, ou l'image n'existe pas ----
#
# Le front était construit sur le PC avant chaque livraison : le NAS ne pouvait rien livrer
# seul, et une page servie pouvait venir d'un dossier de travail. Il se construit ici, dans
# la même image que ce qu'il appelle. Les tests tournent au même endroit : une image dont un
# test échoue n'est jamais produite, donc deploy.sh s'arrête avant la bascule, sans rien
# avoir touché à l'installation en place (docs/SPEC-livraison.md, §4.5).
FROM base AS verification
COPY web/package*.json web/
RUN npm --prefix web ci --no-audit --no-fund
COPY . .
RUN npm --prefix web run build \
 && npm run web:test \
 && npm test

# ---- Image servie ----
FROM base
COPY . .
# Seul le résultat du build entre dans l'image, pas ses 200 Mo de dépendances. Cette copie
# est aussi ce qui oblige l'étage de vérification à tourner : sans elle, BuildKit le sauterait.
COPY --from=verification /app/web/dist/ web/dist/

EXPOSE 4600

# Le cockpit par défaut. Le conteneur du cycle surcharge cette commande.
CMD ["node", "bin/cockpit.js"]
