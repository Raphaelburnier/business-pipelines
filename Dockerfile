# Utilisation d'une image Node.js légère
FROM node:20-alpine

# Définir le dossier de travail dans le conteneur
WORKDIR /app

# Copier les fichiers de dépendances et installer
COPY package*.json ./
RUN npm install --omit=dev

# Copier tout le reste du code
COPY . .

# Exposer le port du Cockpit
EXPOSE 4600
