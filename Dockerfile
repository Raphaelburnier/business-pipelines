FROM node:22-alpine

WORKDIR /app

# Le moteur est déclaré `file:../agent-orchestrator` dans package.json, donc npm le cherche
# à /agent-orchestrator une fois le travail dans /app. Un contexte de build Docker ne remonte
# jamais au-dessus de sa racine, et prendre le dossier parent comme contexte n'est pas une
# option : il porte 27 projets pour 6,7 Go. bin/preparer-image.sh dépose donc les 340 Ko du
# moteur dans .moteur/ avant le build.
COPY .moteur/ /agent-orchestrator/

# Les dépendances avant le code : une modification du code ne réinstalle alors rien.
COPY package*.json ./
RUN npm install --omit=dev

COPY . .

EXPOSE 4600

# Le cockpit par défaut. Le conteneur du cycle surcharge cette commande.
CMD ["node", "bin/cockpit.js"]
