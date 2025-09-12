# Multi-stage build for managerd + agentd (repo layout aware)
# Build context expected at repo root. This Dockerfile lives in infra/Dockerfile
# so in compose use: build: { context: .., dockerfile: infra/Dockerfile }

FROM golang:1.23-alpine AS builder
RUN apk add --no-cache git ca-certificates build-base
WORKDIR /src

# --- Go module lives under ./agent
COPY agent/go.mod agent/go.sum ./
RUN go mod download

# Copy the agent project sources
COPY agent/ ./

# Build statically (CGO disabled)
ENV CGO_ENABLED=0 GOOS=linux GOARCH=amd64
RUN --mount=type=cache,target=/root/.cache/go-build \
    go build -trimpath -ldflags "-s -w" -o /out/managerd ./cmd/manager && \
    go build -trimpath -ldflags "-s -w" -o /out/agentd   ./cmd/agent

# --- Final runtime image
FROM alpine:3.20
RUN apk add --no-cache ca-certificates tzdata && adduser -D -u 10001 app
WORKDIR /app
COPY --from=builder /out/managerd /app/managerd
COPY --from=builder /out/agentd   /app/agentd
USER app

# Default entrypoint is managerd; it will spawn agentd
ENTRYPOINT ["/app/managerd"]
CMD ["-agents-dir","/etc/ggbot/agents.d","-agent-bin","/app/agentd","-redis","redis://redis:6379"]
