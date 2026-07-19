# Infra — Contexte

## Ports

| Service | Port | Usage |
|---------|------|-------|
| Redis | 6379 | Bus événements + état match live |
| PostgreSQL | 5432 | Persistance (tournois, équipes, matchs, historique, séries, serveurs) — **déployé** |
| Backend NestJS | 8081 | API REST (`/api`) + WebSocket (`/ws`) + POST /cs2/logs + Swagger `/api/docs` |
| Agent (logs HTTP + commandes) | 8082+ | Un port par serveur CS2 (srv-a=8082, srv-b=8083...). Sert `/logs` ET les endpoints de commande (`/pause`, `/exec`, `/admin-action`, etc. — voir `agent-go.md`) |
| RCON CS2 | 27015/tcp | Commandes vers serveur CS2 (via l'agent uniquement — le backend n'a plus d'accès RCON direct depuis la migration 005) |
| GOTV CS2 | 27020/udp | Optionnel |

## Docker Compose

Il existe deux points d'entrée Compose ; **préférer le fichier racine** pour le dev courant.

### Racine (`docker-compose.yml`) — usage courant, à base de profiles
```bash
docker compose up -d                                  # redis + postgres + backend (hot-reload)
docker compose --profile agent up -d                  # + manager Go (nécessite agents.d/srv-a.yaml)
docker compose --profile cs2 up -d                     # + serveur CS2 conteneurisé (lourd, ~25 Go)
docker compose --profile tools up -d                   # + log-drain Redis → fichier
docker compose --profile agent --profile cs2 up -d     # tout sauf log-drain
```
Services : `redis`, `postgres` (init via `infra/sql/init.sql`), `backend` (build `backend/Dockerfile.nest.dev`,
hot-reload via volume), `manager` (profile `agent`), `cs2` (profile `cs2`), `log-drain` (profile `tools`).

### `infra/docker-compose.dev.yml` — variante historique (mêmes services, sans profiles, tout démarre ensemble)
```bash
docker compose -f infra/docker-compose.dev.yml up -d --build
```

### Monolith (`infra/docker-compose.monolith.yml`)
- **ggbot-aio** — tout-en-un, ports 3000 (API/WS) + 8081 (/cs2/logs)

### CI (`infra/docker-compose.ci.yml`, `infra/Dockerfile.ci.go`)
Pipeline de vérification compilation + smoke test (voir commit `ci: ajout pipeline de verification compilation + smoke test`).

## Dockerfiles

| Fichier | Contenu |
|---------|---------|
| `infra/Dockerfile` | Multi-stage Go : golang:1.23-alpine → alpine:3.20, compile `managerd` + `agentd` |
| `infra/Dockerfile.ci.go` | Build Go pour CI |
| `backend/Dockerfile.nest.dev` | node:20-alpine, hot-reload dev (`npm run start:dev`), utilisé par les docker-compose dev |
| `backend/Dockerfile.ci` | Multi-stage : deps → typecheck (`tsc --noEmit`) → build → runtime — utilisé en CI |
| `tools/log-drain/Dockerfile` | Service drain logs |

> Le `Dockerfile` racine (multi-stage Go+NestJS+debian+supervisord) et `Dockerfile.agent.dev` ont été
> supprimés — le déploiement mono-image "tout-en-un" via supervisord n'est plus le chemin principal,
> voir `infra/docker-compose.monolith.yml` si ce besoin revient. `backend/Dockerfile` (image simple)
> a aussi été retiré au profit de `Dockerfile.nest.dev` / `Dockerfile.ci`.

## Variables d'environnement Backend
```
PORT=8081
WS_PATH=/ws
JWT_SECRET=dev-change-me
REDIS_URL=redis://redis:6379
DATABASE_URL=postgresql://ggcore:ggcore@postgres:5432/ggcore
SERVER_IDS=srv-a
USE_HTTP_PARSE=false
ALLOWED_IPS=<CIDR whitelist pour /cs2/logs>
CORS_ORIGIN=http://localhost:3000
```
> `.env.example` à la racine est actuellement vide — ces variables sont définies en dur dans les
> fichiers docker-compose pour le dev LAN (mots de passe placeholder, pas de vrai secret).

## PostgreSQL — schéma

Voir `infra/sql/init.sql` (consolidé) et l'historique des migrations `infra/sql/migrate_00N_*.sql` :
- `001` — ajout `status` sur `Match`
- `002` — ajout RCON sur `Server` (puis supprimé en 005)
- `003` — `Tournoi`, `Team`, `TournamentTeam`, `Player` (sync tournoi externe)
- `004` — `agent_port` sur `Server`
- `005` — suppression `rcon_password` sur `Server` (RCON passe uniquement par l'agent HTTP)
- `006` — `agent_host` sur `Server`
- `007` — table `Series` (Bo1/Bo3/Bo5)

Tables : `Tournoi`, `Team`, `TournamentTeam`, `Player`, `Match`, `MatchHistory`, `Server`, `Series`.
Détail des repositories consommateurs : voir `backend.md` → Adapters → PostgreSQL.

## Structure des dossiers infra
```
infra/
├── docker-compose.dev.yml
├── docker-compose.monolith.yml
├── docker-compose.ci.yml
├── Dockerfile
├── Dockerfile.ci.go
├── cs2/gameserver.cfg
├── logs/                      ← sortie du service log-drain
└── sql/
    ├── init.sql                (schéma consolidé)
    └── migrate_00N_*.sql       (historique)

agent/cfg/ggbot/
├── knife.cfg
├── warmup.cfg
├── init.cfg
├── competitive.cfg
└── overtime.cfg

agents.d/
└── srv-a.yaml   ← config agent serveur A (auto-découvert par manager) — contient rcon_password + logs.token,
                     ne pas y mettre de vrais secrets en dehors d'un contexte LAN isolé

docker/
└── supervisord.monolith.conf   (utilisé seulement par docker-compose.monolith.yml)
```

## Déploiement LAN (objectif < 15 min)
1. `docker compose up -d` (depuis la racine)
2. Configurer `agents.d/srv-a.yaml` avec IP + RCON du serveur CS2
3. Enregistrer le serveur en base : `POST /api/servers` avec `server_id`, `ip`, `agent_port` (voir `backend.md`)
4. Sur le serveur CS2 : `rcon_password` + `logaddress_add_http http://<manager-ip>:8082/logs`
5. Démarrer l'agent : `docker compose --profile agent up -d`
6. Créer le match/série : `POST /api/matches/init` (match simple) ou `POST /api/tournaments/:id/series` (Bo1/Bo3/Bo5)

## Dépendances Go (`agent/go.mod`)
- `github.com/fsnotify/fsnotify` — file watching (manager)
- `github.com/gorcon/rcon` — client RCON
- `github.com/redis/go-redis/v9` — client Redis
- `gopkg.in/yaml.v3` — parsing config YAML

## Dépendances Backend (`backend/package.json`)
- `@nestjs/core`, `@nestjs/common`, `@nestjs/platform-express`, `@nestjs/websockets`, `@nestjs/swagger`
- `ioredis` — client Redis
- `pg` — client PostgreSQL
- `jsonwebtoken` — JWT
- `socket.io`, `socket.io-client`
- TypeScript, ESLint, Prettier, Jest/ts-jest
