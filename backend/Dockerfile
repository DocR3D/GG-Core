FROM node:20-alpine

WORKDIR /app

# 1) copier uniquement les manifests et installer
COPY package*.json ./
RUN npm ci

# 2) copier le code (sera surchargé par le bind mount en dev)
COPY . .

ENV NODE_ENV=development \
    PORT=8081 \
    WS_PATH=/ws

EXPOSE 8081

# Hot-reload via nest CLI
CMD ["npm","run","start:dev"]
