# Version mineure épinglée : le store des approbations utilise `node:sqlite`, disponible sans
# option seulement depuis Node 22.13. Une image `node:22-alpine` plus ancienne restée en cache
# sur le NAS ferait tomber le cockpit au premier accès à la base.
FROM node:22.23-alpine

# Le SDK d'agents lance le CLI Claude Code en sous-processus, et ce CLI embarque un ripgrep
# lié à la glibc. Alpine est sur musl, donc ce binaire ne s'exécute pas. USE_BUILTIN_RIPGREP=0
# le renvoie vers celui du système, installé ici. Sans ça les outils de recherche d'un agent
# échouent un par un, ce qui ressemble à un agent qui ne trouve rien plutôt qu'à une image
# mal construite.
RUN apk add --no-cache git openssh-client ripgrep
# Les dépôts de projets montés appartiennent à admindunas, le runner tourne en root. Git
# refuse alors de pousser (« dubious ownership »). Les variables GIT_CONFIG_* du compose ne
# suffisent pas : git les efface pour le sous-processus qui reçoit un push local. Seule une
# configuration système ou globale atteint ce sous-processus.
RUN git config --system --add safe.directory /git/steam-tierlist.git
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

COPY . .

EXPOSE 4600

# Le cockpit par défaut. Le conteneur du cycle surcharge cette commande.
CMD ["node", "bin/cockpit.js"]
