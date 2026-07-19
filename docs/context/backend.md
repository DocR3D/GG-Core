# Backend NestJS — Contexte

## Stack
- NestJS v10, TypeScript
- Redis (ioredis) : état match temps réel + bus événements
- PostgreSQL (`pg`) : persistance (tournois, équipes, matchs, historique, séries, serveurs)
- Socket.IO : WebSocket temps réel
- Port : 8081 (API REST sous `/api`, sauf `/cs2/logs` qui reste à la racine pour l'agent)
- Swagger : `GET /api/docs` (tags : matches, servers, maps, teams, cs2-logs)

## Alias de chemins (tsconfig)
- `@app` → `src/application`
- `@adapters` → `src/adapters`
- `@domain` → `src/domain`

---

## Architecture en 3 couches

### 1. Domain (`src/domain/`) — Métier pur, framework-agnostic

**Events**
- `events/base.event.ts` — `BaseEvent<TType, TPayload>` (v, id, timestamp, source, kind, serverId, matchId, map, round, tick, type, payload)
- `events/event.types.ts` — `EventTypes` constantes, dont les events de fin de vie CS2 : `CS_WIN_PANEL_MATCH` (match terminé), `CS_INTERMISSION` (halftime ou fin d'OT), `BEGIN_NEW_MATCH` (restart serveur)
- `events/match.event.ts` — Types événements match (RoundStartEvent, KillEvent, TeamRoundWinEvent, BombPlantedEvent, etc.)
- `events/chat.event.ts` — ChatEvent
- `events/command.event.ts` — CommandEvent + `buildCommandEvent()`
- `events/internal-events.ts` — InternalEvent + Audience (`public | admin | both`)

**Rules & Context**
- `rules/base.rule.ts` — Interface `PhaseRule` (onEnter, onExit, say, canHandle, handle, canHandleCommand, handleCommand)
- `rules/rule-context.ts` — `RuleContext` (matchId, serverId, state, orch, say)
- `phase.types.ts` — `MatchPhase` enum + `RoundPhase` enum

**Types**
- `commands/base.command.ts` — `ICommand` interface (canHandle, handle)
- `server.types.ts` — `ServerRow` (ligne DB), `ServerDto` (exposé API, sans `agent_token`), `ServerStatus` = `'offline' | 'start' | 'used'`

---

### 2. Application (`src/application/`)

#### Match State (`match/state/`)
Toutes les données live d'un match sont dans Redis (voir clés ci-dessous).

| Service | Rôle |
|---------|------|
| `match-state.service.ts` | Facade pour tous les services d'état |
| `sides-score.service.ts` | Sides (CT/T ↔ home/away), score, `matchConfig` (maxRounds, winRounds, overtimeEnabled, isDecidingMap), addPoint, applyKnifeResult |
| `snapshot.query.ts` | Reconstruit snapshot complet depuis Redis |
| `rosters.service.ts` | Listes joueurs par équipe |
| `economy.service.ts` | Argent + équipement par joueur |
| `timeouts.service.ts` | Banques timeouts tactiques/techniques |
| `sequence.service.ts` | Numéro séquentiel WS |
| `series-state.service.ts` | État Redis d'une série Bo1/Bo3/Bo5 : config, scores de maps, liste des maps, matchId courant par map, `isOver()`/`winner()` |
| `redis.keys.ts` | Toutes les clés Redis centralisées (`redisConst`) |

**Clés Redis importantes (voir `redis.keys.ts`)**
```
match:{id}:phase         — MatchPhase courante
match:{id}:roundPhase    — RoundPhase courante (séparée !)
match:{id}:sides         — hash { home, away } (CT/T)
match:{id}:score         — hash { ct, t, round, phase }
match:{id}:config        — hash { maxRounds, winRounds, overtimeEnabled, isDecidingMap, seriesId, mapNumber }
match:{id}:pause         — hash { state, reason, team, started_at, tac_bank_home, tac_bank_away }
match:{id}:teams         — hash { home_id, home_name, away_id, away_name }
match:{id}:map           — hash { name, set_at }
match:{id}:lineup:home   — list steamIds
match:{id}:lineup:away   — list steamIds
match:{id}:money         — hash steamId→montant
match:{id}:equip         — hash steamId→montant
match:{id}:economy:team  — hash (loss streak, bonus)
match:{id}:ready         — hash { home, away } (0/1)
match:{id}:phase:lock    — lock anti-doublon countdown
match:{id}:phase:pending — phase en attente de countdown
match:{id}:knife_winner_side    — 'CT' | 'T'
match:{id}:knife_winner_logical — 'home' | 'away'
match:{id}:knife_choice         — 'pending' | 'stay' | 'switch'
server:{serverId}:currentMatch  — matchId courant
match:{id}:server               — serverId courant

series:{id}:config       — hash { bo, overtimeEnabled, homeId, awayId }
series:{id}:scores       — hash { home, away } (victoires de maps)
series:{id}:maps         — string JSON (liste des maps + ctTeamLogical par map)
series:{id}:match:{n}    — matchId de la map n
series:{id}:dbId         — id PostgreSQL de la série
```

#### Match Orchestration

**`match-orchestrator.service.ts`** — Facade principale
- `requestPauseTactical()` — pause tactique (armée ou immédiate selon RoundPhase)
- `resume()` — reprise manuelle ou auto-expire
- `applyPauseIfArmed()` — consomme pause armée à la freeze time
- `execCfg()` / `execCfgs()` — exécute fichiers .cfg RCON
- `onFreezeTimeStart()` / `onRoundStart()` / `onRoundEnd()` / `onBombPlanted()` — lifecycle round
- `runHalftime()` / `runOvertime()` / `triggerMatchEnd()` — transitions de fin de régulation
- `push()` — broadcast WS
- `applyKnifeResult()` / `swapSides()` / `setPhase()` / `startPhaseCountdown()`

**`match-phase.service.ts`** — Transitions de phase
- `startPhaseCountdown()` — countdown avec lock Redis anti-doublon
- `cancelPhaseCountdown()` — annule un countdown
- `setPhase()` / `getPhase()` — MatchPhase (clé `match:{id}:phase`)
- `setRoundPhase()` / `getRoundPhase()` — RoundPhase (clé `match:{id}:roundPhase`) ← clé SÉPARÉE
- `isBothReady()` / `setReady()`

#### Règles de phase (`match/rules/`)

| Règle | Phase | Gère |
|-------|-------|------|
| `warmup.rule.ts` | `warmup_main` / `warmup_knife` | `!ready`/`!unready`, countdown vers knife |
| `knife.rule.ts` | `knife_live` | Kills → tie-break deaths → winner → `KNIFE_CHOICE` |
| `knife-choice.rule.ts` | `knife_choice` | `!stay`/`!switch`/`!swap` |
| `live.rule.ts` | `live_main` | Round start/end, kills, pauses, score → déclenche `RegulationService.checkAfterScore()` |

#### Fin de régulation & fin de match (`subscribers/`)

- **`regulation.service.ts`** — Appelé après chaque mise à jour de score en `live_main`/`overtime`.
  Règles : `score >= winRounds` → vainqueur ; `round === maxRounds/2` → halftime (swap sides) ;
  `round >= maxRounds` et égalité → overtime (si activé) ou fin de match.
- **`match-end.handler.ts`** — Gère les events CS2 de fin de vie :
  - `CS_WIN_PANEL_MATCH` → `POSTGAME` définitif
  - `CS_INTERMISSION` → filet de sécurité halftime (si `RegulationService` ne l'a pas déjà déclenché) ou fin d'overtime
  - `BEGIN_NEW_MATCH` → reset score + `WARMUP_MAIN`

#### Séries Bo1/Bo3/Bo5 (`series-state.service.ts` + `tournaments/series-create.controller.ts`)
Une série regroupe plusieurs matchs (maps) liés à un même tournoi/équipes. `SeriesStateService` gère
la config, le score de la série (victoires de maps) et le matchId courant par numéro de map.
Le contrôleur `POST /api/tournaments/:id/series` initialise toute la série (voir Adapters HTTP).

#### Commandes chat (`match/commands/`)
- `ready.command.ts` — `!ready`, `!unready`
- `pause.command.ts` — `!pause`, `!tac`, `!tech`, `!unpause`
- `knife-choice.command.ts` — `!stay`, `!switch`

#### Serveurs CS2 (`servers/`)
- `agent-client.service.ts` — Client HTTP vers l'agent Go. Résout `baseUrl` (`http://{agent_host||ip}:{agent_port}`)
  et le token `X-Agent-Token` depuis PostgreSQL (`ServerRepository`). Méthodes : `health`, `say`, `sayTeam`,
  `pause`, `unpause`, `initMatch`, `changelevel`, `restart`, `exec`, `rcon`, `adminAction`.
- `server-probe.service.ts` — Poll périodique (~20s) de `GET /health` sur chaque agent → cache le statut
  (`offline`/`start`/`used`) et le `currentMatchId` consommés par `ServersController`.
- `rcon.service.ts` — Enveloppe RCON côté backend (au-dessus de `agent-client`).

> ⚠️ Ce client HTTP backend→agent est **distinct** du canal Redis `ggbot:agent:{serverId}:actions`
> décrit dans `agent-go.md` : les deux mécanismes coexistent actuellement dans l'agent Go.

#### Tournois (`tournaments/`)
- `tournament-sync.client.ts` — Appelle l'API externe du système de tournois (plateforme d'inscription GG-Lan).
- `tournament-sync.service.ts` — `OnModuleInit` : sync automatique au démarrage (`sync()` mappe la réponse API
  puis met à jour le cache + `TournamentRepository` en PostgreSQL). Rappelable manuellement.
- `tournament-cache.service.ts` — Cache des tournois/équipes/joueurs pour lecture rapide (utilisé par
  `series-create.controller.ts` pour résoudre équipes/rosters).
- `tournament.mapper.ts` — Mappe le modèle brut de l'API externe (`ApiTournament`/`ApiTeam`/`ApiUser`) vers
  le modèle interne simplifié (`Tournament`/`Team`/`Player`).
- `tournament.types.ts` — Types Source (API externe) et Cible (interne).

#### Subscribers (Event Handlers) (`subscribers/`)

Flow d'un événement :
```
Redis ggbot:events
    → EventsRouterConsumer
        → ChatCommandHandler (si kind=command)
        → MatchEventsHandler
            → PhaseEventsHandler   (PHASE_CHANGED → onExit+onEnter règles)
            → RoundEventsHandler   (ROUND_START, TEAM_ROUND_WIN, ROUND_FREEZE_START → orchestrateur)
            → KillAndBombEventsHandler (BOMB_PLANTED → orchestrateur)
            → MatchEndHandler      (CS_WIN_PANEL_MATCH, CS_INTERMISSION, BEGIN_NEW_MATCH)
            → Rule active (events.get(type) → handler métier)
        → RegulationService.checkAfterScore() (après TEAM_SCORE en live_main/overtime)
```

---

### 3. Adapters (`src/adapters/`)

#### PostgreSQL (`adapters/postgres/`)
Persistance long terme (le detail vivant du match reste dans Redis, PostgreSQL sert d'historique/relationnel).

| Repository | Table(s) | Rôle |
|---|---|---|
| `match.repository.ts` | `Match` | `findDbIdByRedisId`, `insert` (lié à `Tournoi` + `Series` + numéro de map) |
| `match-history.repository.ts` | `MatchHistory` | `insert` — historique d'événements JSONB par match (dont `admin:action`, `series:init`) |
| `series.repository.ts` | `Series` | Séries Bo1/Bo3/Bo5 |
| `server.repository.ts` | `Server` | CRUD serveurs CS2 (ip, port, `server_id`, `agent_port`, `agent_host`, `agent_token`) |
| `tournament.repository.ts` | `Tournoi`, `Team`, `TournamentTeam`, `Player` | `upsertAll` depuis la sync externe |

Schéma complet : `infra/sql/init.sql` (consolidé, migrations `infra/sql/migrate_00N_*.sql` historiques).
Table `Server` : `rcon_password` a été supprimée (migration 005) — les commandes passent uniquement par
l'agent HTTP, plus par RCON direct depuis le backend.

#### HTTP (`adapters/http/`)

| Endpoint | Rôle |
|----------|------|
| `GET /health` | Health check |
| `POST /cs2/logs` | Reçoit logs CS2 (NDJSON), résout matchId, publie Redis |
| `GET /api/matches/:id/snapshot` | État complet match |
| `GET /api/matches/:id/score-with-teams` | Score + équipes |
| `PATCH /api/matches/:id/teams` | Set noms/IDs équipes |
| `POST /api/matches/init` | Créer/initialiser un match simple (hors série) |
| `DELETE /api/matches/:id` | Supprimer un match (`delete.controller.ts`) |
| `POST /api/matches/:matchId/admin-actions` | Pilotage admin : `pause_match`/`unpause_match`/`set_game_phase` (warmup, knife, match_start, overtime, next_map) — valide, historise, délègue à l'agent |
| `GET /api/matches/:id/players` | Joueurs du match |
| `GET /api/matches/:id/economy` | Économie |
| `GET/PUT /api/matches/:id/sides` | Sides |
| `POST /api/tournaments/:id/series` | Crée une série Bo1/Bo3/Bo5 complète (voir Application → Séries) |
| `GET /api/servers` / `GET /api/servers/:id` | Liste/détail serveurs (statut live via probe) |
| `POST /api/servers` / `PATCH /api/servers/:id` / `DELETE /api/servers/:id` | CRUD serveurs |
| `GET /api/maps` | Mappool (`config/maps.json`, rechargé au démarrage) |
| `GET /api/teams` | **Mock** — liste statique en dur, pas encore branché sur PostgreSQL/tournois |
| `POST /api/admin/bind` | Lie manuellement `serverId` ↔ `matchId` (bypass l'init normal, debug/LAN) |
| `POST /api/admin/sides` | Force les sides `{ matchId, home, away }` (debug/LAN) |
| `POST /api/admin/timeouts/init` | Réinitialise les banques de timeouts tactiques (debug/LAN) |

#### WebSocket (`adapters/ws/`)
- `match.gateway.ts` — Socket.IO `/ws`, rooms `match:{id}:public` et `match:{id}:admin`
- `broadcaster.service.ts` — Subscribe `ggbot:events`, mappe vers `InternalEvent`, broadcast WS
- `socket.auth.guard.ts` — Guard JWT (role: admin/viewer)
- `dto/events.dto.ts` — `WsEventType` + tous les types WS typés

#### Redis (`adapters/redis/`)
- Tokens d'injection : `REDIS_CMD`, `REDIS_PUB`, `REDIS_SUB`
- 3 clients distincts (commandes/lecture, publication, souscription)

---

## Phases du match

```
warmup_knife → knife_live → knife_choice → warmup_main → live_main
                                                            ↓
                                                        halftime (half_time)
                                                            ↓
                                                        overtime / postgame

Pauses transverses : paused_tac, paused_tech
```

## RoundPhase (dans live_main)
```
warmup → freeze → live → bomb_planted → end
```

## Règle de séparation MatchPhase / RoundPhase
- `MatchPhase` → clé `match:{id}:phase` (warmup_knife, live_main, etc.)
- `RoundPhase` → clé `match:{id}:roundPhase` (freeze, live, bomb_planted, end)
- **Ces deux clés sont distinctes** — ne pas confondre

## Points d'attention / dette connue
- `TeamsController` (`GET /api/teams`) renvoie un mock statique — pas encore relié à PostgreSQL ni au cache tournoi.
- Deux mécanismes de commande coexistent vers l'agent : Redis pub/sub (`ggbot:agent:{serverId}:actions`, historique)
  et HTTP direct (`AgentClientService`, utilisé par tous les contrôleurs actuels). Pas encore unifié.
- Pas de commande CS2 vanilla pour forcer un score arbitraire à l'entrée en overtime (voir `agent-go.md`).
