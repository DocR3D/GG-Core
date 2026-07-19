# GG-Core — Contexte Claude

## Projet
GG-Core (eBot++) — Gestionnaire de matchs CS2 pour tournois LAN.
Architecture distribuée : Agent Go + Backend NestJS + Redis + PostgreSQL + Frontend Next.js (non implémenté).

## Fichiers de contexte
Lire ces fichiers au démarrage pour avoir le contexte complet (détails à jour, ne pas dupliquer ici) :

- `docs/context/agent-go.md` — Agent Go : manager, agent, packages, config YAML, endpoints HTTP + canal Redis, fichiers .cfg
- `docs/context/backend.md` — Backend NestJS : couches Domain/Application/Adapters, PostgreSQL, tournois, séries Bo1/Bo3/Bo5, clés Redis, règles de phase, API, WebSocket
- `docs/context/frontend.md` — Frontend : stack prévue, events WS disponibles, interfaces Admin/Public/Joueur
- `docs/context/infra.md` — Infra : ports, Docker Compose (profiles), PostgreSQL, déploiement LAN, dépendances
- `docs/context/docs-index.md` — Index documentation + résumé cahier des charges + état d'avancement réel

## Stack
- **Agent** : Go 1.24 (module `ggbot`), RCON, Redis pub/sub + streams, endpoints HTTP de commande
- **Backend** : NestJS v10 (TypeScript), Socket.IO, Redis, PostgreSQL, port 8081, Swagger sur `/api/docs`
- **Frontend** : Next.js (non implémenté)
- **Infra** : Docker Compose (profiles `agent`/`cs2`/`tools`), Redis 7, Postgres 16

## Environnement de dev
```bash
docker compose up -d                                # redis + postgres + backend (hot-reload)
docker compose --profile agent up -d                # + manager Go (agents.d/srv-a.yaml requis)
docker compose --profile cs2 up -d                   # + serveur CS2 conteneurisé (~25 Go)
```
Détails, variantes et schéma PostgreSQL : `docs/context/infra.md`.

## Commandes

### Backend (`backend/`) — ciblées d'abord (retour rapide)
```bash
npm run typecheck                                    # tsc --noEmit (rapide, pas d'écriture disque)
npx eslint src/path/to/file.ts --fix                  # lint un seul fichier
npm test -- src/path/to/file.spec.ts                  # un seul fichier de test (Jest)
```
### Backend — suite complète (seulement si explicitement demandé)
```bash
npm run lint            # eslint sur tout src/
npm run build            # nest build
npm test                 # tout Jest
npm run test:coverage
```
### Agent Go (`agent/`)
```bash
go build ./cmd/manager && go build ./cmd/agent        # compile les deux binaires
go test ./...
```
### Vérification globale (typecheck + build + Go build + smoke test docker)
```bash
./scripts/check.sh              # utilisé en CI
./scripts/check.sh --no-smoke   # sans le smoke test docker (plus rapide en local)
```

## Alias TypeScript (backend)
- `@app` → `src/application`
- `@adapters` → `src/adapters`
- `@domain` → `src/domain`

## Ports
- Redis : 6379
- PostgreSQL : 5432
- Backend API + WS : 8081
- Agent logs HTTP + commandes : 8082+ (un par serveur)
- RCON CS2 : 27015 (accessible uniquement depuis l'agent, pas depuis le backend)

## Phases du match
```
warmup_knife → knife_live → knife_choice → warmup_main → live_main → halftime → overtime → postgame
```

## Clés Redis critiques
- `match:{id}:phase` — MatchPhase courante
- `match:{id}:roundPhase` — RoundPhase courante (clé SÉPARÉE, ne pas confondre)
- `match:{id}:config` — maxRounds/winRounds/overtimeEnabled/isDecidingMap/seriesId
- `ggbot:events` — channel pub/sub principal
- `ggbot:agent:{serverId}:actions` — canal Redis historique vers l'agent (coexiste avec l'HTTP direct, voir `agent-go.md`)
- `server:{serverId}:currentMatch` — liaison serveur ↔ match
- `series:{id}:*` — état d'une série Bo1/Bo3/Bo5

## Tests — conventions
- Framework : Jest + ts-jest, config `backend/jest.config.ts`
- Fichiers spec colocalisés avec le fichier source (ex : `knife.rule.spec.ts` à côté de `knife.rule.ts`)
- Si un test révèle un bug non corrigé : commenter avec `// TODO BUG Bxx : <explication> — fix: <fichier:ligne>`
  (voir `docs/test-cases.md` pour B-01, B-02 déjà tracés), ne **pas** utiliser `it.failing` en CI

## Git & Pull Requests
- Commits : préfixe conventionnel (`fix:`, `test:`, `ci:`, `feat:`, `refactor:`) + description claire en français
- Ne jamais committer de vrais secrets. `agents.d/*.yaml` est actuellement suivi par git avec des
  identifiants placeholder (contexte LAN) — ne pas y mettre de vrai `rconPassword`/token de prod
- Ne pas committer `.claude/` (config locale)

## Sécurité
- Secrets/config sensible : `agents.d/*.yaml` (RCON, token logs), variables backend (`JWT_SECRET`,
  `DATABASE_URL`, `agent_token` en base `Server`) — voir `docs/context/infra.md` pour la liste complète
- `.env.example` à la racine est vide ; les valeurs de dev sont en dur dans les docker-compose (placeholders LAN, pas des secrets réels)
- Ne jamais logger `agent_token`/`rconPassword` ; `agent_token` n'est jamais exposé par l'API (`ServersController` le filtre)

## Structure du projet
```
/agent       # Go : manager (orchestre N agents) + agent (RCON, logs HTTP, commandes)
/backend     # NestJS : Domain/Application/Adapters, API REST, WS, PostgreSQL
/frontend    # non implémenté
/infra       # Docker Compose, Dockerfiles, schéma SQL (infra/sql/)
/docs        # architecture, contexte, plans, cas de test
/agents.d    # config YAML par serveur CS2 (auto-découverte par le manager)
```

## Focus actuel / dette connue
- Pas de gestion de crash serveur CS2 pour l'instant (voir scénario 5 du cahier des charges, non couvert)
- Deux mécanismes de commande vers l'agent coexistent (Redis pub/sub historique + HTTP direct) — pas unifiés
- `GET /api/teams` est un mock statique, pas encore relié à PostgreSQL/tournois
- Détail complet de l'état d'avancement vs cahier des charges : `docs/context/docs-index.md`

## Plans d'implémentation
- `docs/plans/admin-actions-api.md` — API `POST /matches/:matchId/admin-actions` — **implémenté**, document conservé comme référence de conception
