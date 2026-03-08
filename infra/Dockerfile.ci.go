# =============================================================================
# GG-Core Agent Go — Image CI (compile uniquement, sort 0 si OK)
# =============================================================================
FROM golang:1.23-alpine AS builder
RUN apk add --no-cache git ca-certificates build-base
WORKDIR /src
COPY agent/go.mod agent/go.sum ./
RUN go mod download
COPY agent/ ./
ENV CGO_ENABLED=0 GOOS=linux GOARCH=amd64
RUN --mount=type=cache,target=/root/.cache/go-build \
    go build -trimpath -ldflags "-s -w" -o /out/managerd ./cmd/manager && \
    go build -trimpath -ldflags "-s -w" -o /out/agentd   ./cmd/agent

FROM alpine:3.20
COPY --from=builder /out/managerd /app/managerd
COPY --from=builder /out/agentd   /app/agentd
CMD ["/app/managerd", "--help"]
