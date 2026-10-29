# GG-Core

Orchestrateur de tournois **Counter-Strike 2** pour LAN et compétitions (successeur d'eBot).
Contrôle des matchs (knife, swap, pauses, overtime), collecte des événements, API REST + WebSocket, et interfaces live.
**Zero plugin** : le serveur CS2 ne communique qu'en RCON natif et `logaddress_add_http`.

---

## Technologies

- **Agent** : Go (RCON, ingestion des logs HTTP, parsing)
- **Backend** : NestJS (TypeScript), Socket.IO
- **Base de données** : PostgreSQL 16 + Prisma (event sourcing, tournois)
- **Cache / Bus temps réel** : Redis 7
- **Frontend** : Next.js *(à venir — en attendant, une console Sandbox est servie par le backend)*
- **Conteneurisation** : Docker + Docker Compose

Prévu : analyse CSTV/GOTV (positions, grenades), replays mini-map.

---

## Démarrage rapide

### Prérequis
- Docker + Docker Compose
- `git`

### Installation
```bash
git clone https://github.com/DocR3D/GG-Core.git
cd GG-Core/infra
docker compose -f docker-compose.dev.yml up -d --build
docker compose -f docker-compose.dev.yml logs -f
```

- Backend (REST) : http://localhost:8081/api (health : `/api/health`)
- WebSocket : ws://localhost:8081
- Console Sandbox (rejeu de logs, injection d'état, RCON) : http://localhost:8081/sandbox

### Configuration serveur CS2
Les logs CS2 sont envoyés à l'**agent Go** du serveur (un port par serveur, `8082` pour `srv-a`), qui les parse puis les transmet au backend.
Dans la config du serveur CS2 :

```
rcon_password 123456
logaddress_add_http "http://<AGENT_HOST>:8082/logs?token=<logs.token de agents.d/srv-a.yaml>"
```

> ⚠️ Ne pas pointer CS2 directement vers le backend (`/cs2/logs`) : cet endpoint attend des événements **JSON déjà parsés** par l'agent et rejette les lignes de log brutes (HTTP 400).

---

## Structure du dépôt
```
/agent       # Go : agent (RCON, logs HTTP, parser) + manager (1 agent par serveur)
/agents.d    # Config YAML d'un agent par serveur CS2
/backend     # NestJS : moteur de match, API REST, WebSocket, Sandbox
/infra       # Docker Compose (dev, ci, monolith)
/docs        # Cahier des charges, architecture, contexte technique
/test        # Fixtures (logs CS2 réels anonymisés, scénarios, backups)
```

---

## Docs
- [Architecture détaillée](./docs/architecture.md)
- [Cahier des charges](./docs/cahier-des-charges.md)
- [Contexte technique (agent, backend, frontend, infra)](./docs/context/docs-index.md)
- [Backlog MVP](./docs/context/todo.md)
- [Cas de test](./docs/test-cases.md)
- [Guide agents IA / contributeurs](./AGENTS.md)
