# Build stage
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Runtime stage
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
# Copie uniquement le nécessaire au run
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
# Variables par défaut (écrasables via .env / compose)
ENV PORT=8081
EXPOSE 8081
CMD ["node", "dist/main.js"]
