# Infra — Contexte

## Ports

| Service | Port | Usage |
|---------|------|-------|
| Redis | 6379 | Bus événements + état match |
| Backend NestJS | 8081 | API REST + WebSocket + POST /cs2/logs |
| Agent (logs HTTP) | 8082+ | Un port par serveur CS2 (srv-a=8082, srv-b=8083...) |
| RCON CS2 | 27015/tcp | Commandes vers serveur CS2 |
| GOTV CS2 | 27020/udp | Optionnel |
| PostgreSQL | 5432 | Persistance tournois, stats, sourcing événements (Prisma) |

## Docker Compose

### Dev (`infra/docker-compose.dev.yml`) — piloté par le `Makefile` racine
`make up` (stack), `make up-cs2` (+ CS2 conteneurisé), `make up CS2=local` (CS2 hors Docker), `make test`, `make replay F=…`, `make logs S=…`, `make doctor`, `make reset`. Seul prérequis : Docker + Compose v2 (sous Windows : depuis un terminal WSL).

Services (réseau `ggcore` 172.30.0.0/24) :
- **redis** — `redis:7-alpine`, port 6379
- **postgres** — `postgres:16-alpine`, port 5432, volume `infra_pgdata`
- **backend** — NestJS dev (hot-reload), port 8081, volume `../backend:/app` + `../test:/test:ro` (fixtures) ; au démarrage : `prisma generate` + `prisma db push` (`npx --no-install` : aucun téléchargement au runtime). `node_modules` = volume anonyme renouvelé à chaque `make up`.
- **manager** — Go manager, IP fixe 172.30.0.10, volumes `../agents.d` + `../agent/cfg`, ports 8082-8083. Les YAML `agents.d/*.yaml` acceptent `${VAR:-défaut}` : défauts natifs (127.0.0.1), surchargés par compose (`GG_REDIS_URL`, `GG_BACKEND_URL`, `GG_CS2_HOST`, `GG_RCON_PASSWORD`, `GG_LOGS_TOKEN`).
- **cs2** *(profil `cs2`)* — `cm2network/cs2` vanilla, ports 27015 tcp/udp + 27020 udp, volume `infra_cs2data` (~73 Go au 1er lancement), `logaddress_add_http` → `http://172.30.0.10:8082/logs`.
- **log-drain** *(profil `debug`)* — copie le bus Redis dans `infra/logs/`.

### Monolith (`infra/docker-compose.monolith.yml`)
- **ggbot-aio** — tout-en-un, ports 3000 (API/WS) + 8081 (/cs2/logs)

## Dockerfiles

| Fichier | Contenu |
|---------|---------|
| `infra/Dockerfile` | Multi-stage Go : golang:1.23-alpine → alpine:3.20, compile `managerd` + `agentd` |
| `backend/Dockerfile` | node:20-alpine, `npm ci`, `npx prisma generate`, `npm run start:dev` |
| `Dockerfile` (racine) | Multi-stage Go + NestJS + debian, supervisord pour multi-process |
| `tools/log-drain/Dockerfile` | Service drain logs |

## Variables d'environnement Backend
```
PORT=8081
WS_PATH=/ws
REDIS_URL=redis://redis:6379
DATABASE_URL=postgresql://postgres:postgres@postgres:5432/ggcore?schema=public
ALLOWED_IPS=<CIDR whitelist pour /cs2/logs>
CORS_ORIGIN=http://localhost:3000
# Secrets générés aléatoirement au premier `make` dans .env (infra/gen-secrets.sh), jamais écrasés ;
# le compose refuse de démarrer sans eux (aucune valeur par défaut publique). Voir .env.example, `make admin`.
JWT_SECRET, GG_ADMIN_TOKEN, GG_ADMIN_PASSWORD, GG_LOGS_TOKEN, GG_RCON_PASSWORD
# À renseigner
GG_ADMIN_STEAMIDS=<SteamID64 des admins, séparés par des virgules>
AUTH_PUBLIC_URL=                 # URL publique si Steam doit renvoyer le navigateur ailleurs (tunnel)
AUTH_DISABLED=                   # 1 = pas d'authentification (dev jetable uniquement, jamais en LAN)
```

## Structure des dossiers infra
```
infra/
├── docker-compose.dev.yml
├── docker-compose.ci.yml
├── docker-compose.monolith.yml
└── Dockerfile

cfg/
└── ggbot/
    └── knife.cfg

agent/cfg/
└── ggbot/
    ├── knife.cfg
    ├── knife_undo.cfg
    ├── warmup.cfg
    └── overtime.cfg

agents.d/
└── srv-a.yaml   ← config agent serveur A (auto-découvert par manager)

docker/
└── supervisord.monolith.conf
```

## Déploiement LAN (objectif < 15 min)
1. `docker compose -f infra/docker-compose.dev.yml up -d`
2. Configurer `agents.d/srv-a.yaml` avec IP + RCON du serveur CS2
3. Sur le serveur CS2 : `rcon_password` + `logaddress_add_http "http://<manager-ip>:8082/logs?token=<logs.token>"`
4. Appliquer le schéma PostgreSQL : `cd backend && npx prisma db push`
5. Créer le match via `POST /api/matches/:id/start` (ou `/init`), avec `matchMapId` pour lier l'historique au tournoi

## Dépendances Go (`agent/go.mod`)
- `github.com/fsnotify/fsnotify` — file watching (manager)
- `github.com/gorcon/rcon` — client RCON
- `github.com/redis/go-redis/v9` — client Redis
- `gopkg.in/yaml.v3` — parsing config YAML

## Dépendances Backend (`backend/package.json`)
- `@nestjs/core`, `@nestjs/common`, `@nestjs/platform-express`, `@nestjs/websockets`
- `ioredis` — client Redis
- `@prisma/client`, `prisma` — ORM & PostgreSQL
- `jsonwebtoken` — JWT
- `socket.io`, `socket.io-client`
- TypeScript, ESLint, Prettier
