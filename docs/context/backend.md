# Backend NestJS — Contexte

## Stack
- NestJS v10, TypeScript
- Redis (ioredis) : état match + bus événements
- Socket.IO : WebSocket temps réel
- Port : 8081

## Alias de chemins (tsconfig)
- `@app` → `src/application`
- `@adapters` → `src/adapters`
- `@domain` → `src/domain`

---

## Architecture en 3 couches

### 1. Domain (`src/domain/`) — Métier pur, framework-agnostic

**Events**
- `events/base.event.ts` — `BaseEvent<TType, TPayload>` (v, id, timestamp, source, kind, serverId, matchId, map, round, tick, type, payload)
- `events/event.types.ts` — `EventTypes` constantes (30+ types)
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

---

### 2. Application (`src/application/`)

#### Match State (`match/state/`)
Toutes les données match sont dans Redis.

| Service | Rôle |
|---------|------|
| `match-state.service.ts` | Facade pour tous les services d'état |
| `sides-score.service.ts` | Sides (CT/T ↔ home/away), score, addPoint, applyKnifeResult |
| `snapshot.query.ts` | Reconstruit snapshot complet depuis Redis |
| `rosters.service.ts` | Listes joueurs par équipe |
| `economy.service.ts` | Argent + équipement par joueur |
| `timeouts.service.ts` | Banques timeouts tactiques/techniques |
| `sequence.service.ts` | Numéro séquentiel WS |
| `redis.keys.ts` | Toutes les clés Redis centralisées |

**Clés Redis importantes (voir `redis.keys.ts`)**
```
match:{id}:phase         — MatchPhase courante
match:{id}:roundPhase    — RoundPhase courante (séparée !)
match:{id}:sides         — hash { home, away } (CT/T)
match:{id}:score         — hash { ct, t, round, phase }
match:{id}:pause         — hash { state, reason, team, started_at, tac_bank_home, tac_bank_away }
match:{id}:teams         — hash { ct_id, t_id, home_id, away_id, ct_name, t_name, home_name, away_name }
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
```

#### Match Orchestration

**`match-orchestrator.service.ts`** — Facade principale
- `requestPauseTactical()` — pause tactique (armée ou immédiate selon RoundPhase)
- `resume()` — reprise manuelle ou auto-expire
- `applyPauseIfArmed()` — consomme pause armée à la freeze time
- `execCfg()` / `execCfgs()` — exécute fichiers .cfg RCON
- `onFreezeTimeStart()` / `onRoundStart()` / `onRoundEnd()` / `onBombPlanted()` — lifecycle round
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
| `live.rule.ts` | `live_main` | Round start/end, kills, pauses, score |

#### Commandes chat (`match/commands/`)
- `ready.command.ts` — `!ready`, `!unready`
- `pause.command.ts` — `!pause`, `!tac`, `!tech`, `!unpause`
- `knife-choice.command.ts` — `!stay`, `!switch`

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
            → Rule active (events.get(type) → handler métier)
```

---

### 3. Adapters (`src/adapters/`)

#### HTTP (`adapters/http/`)

| Endpoint | Rôle |
|----------|------|
| `GET /health` | Health check |
| `POST /cs2/logs` | Reçoit logs CS2 (NDJSON), résout matchId, publie Redis |
| `GET /api/matches/:id/snapshot` | État complet match |
| `GET /api/matches/:id/score-with-teams` | Score + équipes |
| `PATCH /api/matches/:id/teams` | Set noms/IDs équipes |
| `POST /api/matches/init` | Créer/initialiser un match |
| `GET /api/matches/:id/players` | Joueurs du match |
| `GET /api/matches/:id/economy` | Économie |
| `GET/PUT /api/matches/:id/sides` | Sides |

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
                                                        halftime
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
