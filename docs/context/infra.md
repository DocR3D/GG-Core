# Infra — Contexte

## Ports

| Service | Port | Usage |
|---------|------|-------|
| Redis | 6379 | Bus événements + état match |
| Backend NestJS | 8081 | API REST + WebSocket + POST /cs2/logs |
| Agent (logs HTTP) | 8082+ | Un port par serveur CS2 (srv-a=8082, srv-b=8083...) |
| RCON CS2 | 27015/tcp | Commandes vers serveur CS2 |
| GOTV CS2 | 27020/udp | Optionnel |
| PostgreSQL | 5432 | Planifié (non déployé) |

## Docker Compose

### Dev (`infra/docker-compose.dev.yml`)
Services :
- **redis** — `redis:7-alpine`, port 6379
- **backend** — NestJS dev (hot-reload), port 8081, volume `../backend:/app`
- **manager** — Go manager, volumes `../agents.d:/etc/ggbot/agents.d` + `../agent/cfg:/app/cfg`, expose 8082-8083
- **log-drain** — consomme Redis streams → fichier

### Monolith (`infra/docker-compose.monolith.yml`)
- **ggbot-aio** — tout-en-un, ports 3000 (API/WS) + 8081 (/cs2/logs)

## Dockerfiles

| Fichier | Contenu |
|---------|---------|
| `infra/Dockerfile` | Multi-stage Go : golang:1.23-alpine → alpine:3.20, compile `managerd` + `agentd` |
| `backend/Dockerfile` | node:20-alpine, `npm ci`, `npm run start:dev` |
| `Dockerfile` (racine) | Multi-stage Go + NestJS + debian, supervisord pour multi-process |
| `tools/log-drain/Dockerfile` | Service drain logs |

## Variables d'environnement Backend
```
PORT=8081
WS_PATH=/ws
JWT_SECRET=dev-change-me
REDIS_URL=redis://redis:6379
ALLOWED_IPS=<CIDR whitelist pour /cs2/logs>
CORS_ORIGIN=http://localhost:3000
```

## Structure des dossiers infra
```
infra/
├── docker-compose.dev.yml
├── docker-compose.monolith.yml
└── Dockerfile

cfg/
└── ggbot/
    └── knife.cfg

agent/cfg/
└── ggbot/
    ├── knife.cfg
    ├── knife_undo.cfg
    └── warmup.cfg

agents.d/
└── srv-a.yaml   ← config agent serveur A (auto-découvert par manager)

docker/
└── supervisord.monolith.conf
```

## Déploiement LAN (objectif < 15 min)
1. `docker compose -f infra/docker-compose.dev.yml up -d`
2. Configurer `agents.d/srv-a.yaml` avec IP + RCON du serveur CS2
3. Sur le serveur CS2 : `rcon_password` + `logaddress_add_http http://<manager-ip>:8082/logs`
4. Créer le match via `POST /api/matches/init`

## Dépendances Go (`agent/go.mod`)
- `github.com/fsnotify/fsnotify` — file watching (manager)
- `github.com/gorcon/rcon` — client RCON
- `github.com/redis/go-redis/v9` — client Redis
- `gopkg.in/yaml.v3` — parsing config YAML

## Dépendances Backend (`backend/package.json`)
- `@nestjs/core`, `@nestjs/common`, `@nestjs/platform-express`, `@nestjs/websockets`
- `ioredis` — client Redis
- `jsonwebtoken` — JWT
- `socket.io`, `socket.io-client`
- TypeScript, ESLint, Prettier
