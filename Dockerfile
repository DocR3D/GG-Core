# ---------- Stage 1: build Go agent ----------
FROM golang:1.23 AS go-builder
WORKDIR /work

# modules pour cache
COPY parser/go.mod parser/go.sum ./parser/
RUN cd parser && go mod download

# code complet
COPY parser ./parser

# build agent
RUN --mount=type=cache,target=/go/pkg/mod \
    cd parser/cmd/agent && \
    CGO_ENABLED=0 GOOS=linux GOARCH=amd64 \
    go build -o /out/ggbot-agent .

# ---------- Stage 2: build NestJS ----------
FROM node:20-alpine AS nest-builder
WORKDIR /app
COPY backend/ggbot-backend/package*.json ./
RUN npm ci
COPY backend/ggbot-backend ./
RUN npm run build

# ---------- Stage 3: prod deps NestJS ----------
FROM node:20-alpine AS nest-prod-deps
WORKDIR /app
COPY backend/ggbot-backend/package*.json ./
RUN npm ci --omit=dev

# ---------- Stage 4: final runtime ----------
FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl supervisor redis-server nodejs \
    && rm -rf /var/lib/apt/lists/*

RUN mkdir -p /opt/ggbot-backend /etc/ggbot /var/log/supervisor

# NestJS (dist + deps prod)
COPY --from=nest-builder /app/dist /opt/ggbot-backend/dist
COPY --from=nest-prod-deps /app/node_modules /opt/ggbot-backend/node_modules
COPY --from=nest-builder /app/package*.json /opt/ggbot-backend/

# Agent Go
COPY --from=go-builder /out/ggbot-agent /usr/local/bin/ggbot-agent

# Config agent
COPY parser/config.yaml /etc/ggbot/config.yaml

# Supervisord
COPY docker/supervisord.monolith.conf /etc/supervisor/conf.d/ggbot.conf

# ENV
ENV NEST_PORT=3000 \
    NEST_REDIS_URL=redis://127.0.0.1:6379 \
    NEST_LOGS_PORT=8081

EXPOSE 3000 8081

CMD ["supervisord","-n","-c","/etc/supervisor/conf.d/ggbot.conf"]
