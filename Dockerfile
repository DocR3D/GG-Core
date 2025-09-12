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

# Multi-stage build for managerd + agentd
# Usage: docker build -t ggbot/manager:dev .


FROM golang:1.22-alpine AS builder
RUN apk add --no-cache git ca-certificates build-base
WORKDIR /app


# Cache modules
COPY go.mod go.sum ./
RUN go mod download


# Copy sources
COPY . .


# Build statically (CGO disabled)
ENV CGO_ENABLED=0 GOOS=linux GOARCH=amd64
RUN --mount=type=cache,target=/root/.cache/go-build \
go build -trimpath -ldflags "-s -w" -o /out/managerd ./cmd/manager && \
go build -trimpath -ldflags "-s -w" -o /out/agentd ./cmd/agent


# Final image
FROM alpine:3.20
RUN apk add --no-cache ca-certificates tzdata && adduser -D -u 10001 app
WORKDIR /app
COPY --from=builder /out/managerd /app/managerd
COPY --from=builder /out/agentd /app/agentd
USER app


# Default entrypoint is managerd; override with `command:` in compose
ENTRYPOINT ["/app/managerd"]
# Example default args (override in compose):
CMD ["-agents-dir","/etc/ggbot/agents.d","-agent-bin","/app/agentd","-redis","redis://redis:6379"]

# Supervisord
COPY docker/supervisord.monolith.conf /etc/supervisor/conf.d/ggbot.conf

# ENV
ENV NEST_PORT=3000 \
    NEST_REDIS_URL=redis://127.0.0.1:6379 \
    NEST_LOGS_PORT=8081

EXPOSE 3000 8081

CMD ["supervisord","-n","-c","/etc/supervisor/conf.d/ggbot.conf"]
