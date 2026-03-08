# GG-Core — Contexte Claude

## Projet
GG-Core (eBot++) — Gestionnaire de matchs CS2 pour tournois LAN.
Architecture distribuée : Agent Go + Backend NestJS + Redis + Frontend Next.js (WIP).

## Fichiers de contexte
Lire ces fichiers au démarrage pour avoir le contexte complet :

- `docs/context/agent-go.md` — Agent Go : manager, agent, packages, config YAML, actions Redis
- `docs/context/backend.md` — Backend NestJS : couches Domain/Application/Adapters, clés Redis, règles de phase, API, WebSocket
- `docs/context/frontend.md` — Frontend : stack prévue, events WS disponibles, interfaces Admin/Public/Joueur
- `docs/context/infra.md` — Infra : ports, Docker Compose, déploiement LAN, dépendances
- `docs/context/docs-index.md` — Index documentation + résumé cahier des charges

## Résumé rapide

### Stack
- **Agent** : Go 1.24, RCON, Redis pub/sub + streams
- **Backend** : NestJS v10 (TypeScript), Socket.IO, Redis, port 8081
- **Frontend** : Next.js (non implémenté)
- **Infra** : Docker Compose, Redis 7

### Alias TypeScript (backend)
- `@app` → `src/application`
- `@adapters` → `src/adapters`
- `@domain` → `src/domain`

### Ports
- Redis : 6379
- Backend API + WS : 8081
- Agent logs HTTP : 8082+ (un par serveur)
- RCON CS2 : 27015

### Phases du match
```
warmup_knife → knife_live → knife_choice → warmup_main → live_main → halftime → overtime → postgame
```

### Clés Redis critiques
- `match:{id}:phase` — MatchPhase courante
- `match:{id}:roundPhase` — RoundPhase courante (clé SÉPARÉE)
- `ggbot:events` — channel pub/sub principal
- `ggbot:agent:{serverId}:actions` — commandes vers l'agent
- `server:{serverId}:currentMatch` — liaison serveur ↔ match

## Focus actuel
1 seul serveur CS2, pas de gestion des crashs — cas simple en priorité.
