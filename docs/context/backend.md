# Backend NestJS — Contexte

## Stack
- NestJS v10, TypeScript
- Redis (ioredis) : état match + bus événements
- PostgreSQL + Prisma : persistance tournois, stats, bracket, sourcing événements
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
match:{id}:db_match_map         — UUID du MatchMap PostgreSQL lié (optionnel)
```

#### Match Orchestration

**`match-orchestrator.service.ts`** — Facade principale
- `requestPauseTactical()` — pause tactique (armée ou immédiate selon RoundPhase)
- `resume()` — reprise manuelle ou auto-expire
- `applyPauseIfArmed()` — consomme pause armée à la freeze time
- `execCfg()` / `execCfgs()` — applique un .cfg GG-Core (`agent/cfg/ggbot`) **via l'agent** (`exec_cfg`) ; jamais en `exec` RCON brut (ces fichiers n'existent pas sur le serveur)
- `startMatch()` — `tv_enable 1`, changelevel, warmup.cfg, `tv_record`, banques de pause (`tacticalPauseBankSec`), phase initiale
- `endMatch()` — annonce, `tv_stoprecord`, progression bracket, puis **différé** : reset warmup à `postgameResetDelaySec` (30 s) et kick des joueurs à `postgameKickDelaySec` (120 s, 0 = off), ignorés si un autre match a démarré sur le serveur
- `onServerGameOver()` / `checkServerGameOver()` / `resolveReview()` — arbitrage du `Game Over` serveur : score = serveur, verdict = règlement GG-Core ; désaccord → résultat gelé (`match:{id}:review`) en attendant l'admin
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
| `GET /api/health` | Health check |
| `POST /cs2/logs` | Reçoit les événements **JSON déjà parsés par l'agent** (NDJSON / tableau / objet), résout matchId, publie Redis. Une ligne de log CS2 brute → 400 |
| `GET /api/matches/:id/snapshot` | État complet match |
| `GET /api/matches/:id/score-with-teams` | Score + équipes |
| `PATCH /api/matches/:id/teams` | Set noms/IDs équipes |
| `POST /api/matches/:id/init` | Initialise un match (sides, score, timeouts, équipes, settings, liaison `serverId`, liaison `matchMapId` PostgreSQL) |
| `POST /api/matches/:id/start` | `init` + démarrage serveur (changelevel, warmup.cfg, `tv_record`, phase initiale). `settings` : `knifeEnabled`, `mrFormat`, `overtimeEnabled`, `overtimeMrFormat`, `warmupAfterKnife`, `warmupAtHalftime`, `warmupAtOvertime`, `postgameAction`, `postgameResetDelaySec`, `postgameKickDelaySec`, `tacticalPauseBankSec` |
| `GET /api/tournament/tournaments` · `DELETE /api/tournament/tournaments/:id` | Liste des tournois · suppression d'un tournoi (phases, matchs, games en cascade) et des équipes qui ne jouent dans aucun autre tournoi |
| `POST /api/tournament/tournaments` · `POST /api/tournament/teams` | Créer un tournoi (`{ name, slug?, game? }`, jeu `cs2` par défaut) · des équipes par nom (`{ names }`, en attendant l'import) |
| `POST /api/tournament/tournaments/:id/stages` | Créer une phase : `{ name, type: ROUND_ROBIN \| DOUBLE_ELIM, order, settings? }` |
| `POST /api/tournament/stages/:id/groups/generate` | Poules : `{ teamIds? (ordre des seeds), groupCount, format? }` → répartition en serpentin + matchs chacun contre chacun. Sans `teamIds`, prend les qualifiés de la phase. Refusé si un match de la phase est terminé |
| `POST /api/tournament/stages/:id/bracket/generate` | Double élimination pour les qualifiés de la phase (ou `teamIds` en ordre de seed), n'importe quel effectif ≥ 3 : exempts résolus à la génération (y compris dans le bracket du bas), places exactes vainqueur / perdant, grande finale avec **1 map d'avance** au finaliste du haut. `formats: { upper, lower, grandFinal }` (défauts BO1 / BO1 / BO3, grande finale BO3 ou BO5). Refusé si un match de la phase est terminé. Classement final dans la vue (1, 2, 3, 4, 5-6, 7-8…) |
| `GET /api/tournament/stages/:id/standings` | Classement de chaque poule (points 3/1/0, puis confrontation directe, différence de score, score marqué ; `tied` = égalité à trancher par l'admin) |
| `POST /api/tournament/stages/:id/qualify` | `{ rules: [{ ranks: [1,2], targetStageId }, …], manualOrder? }` → qualifiés envoyés aux phases suivantes, seeds croisés (1ers A, B…, puis 2es). Refusé si poules non terminées ou égalité non résolue à une frontière |
| `POST /api/tournament/matches/:id/games/:order/result` | **Saisie admin** du résultat du game n° `order` d'une série (Match en base, UUID) : `{ scoreHome, scoreAway, mapName?, reportedBy? }` → game `MANUAL` / `CONFIRMED`, puis mise à jour de la série (BO1/BO3/BO5) et de l'arbre. 404 match inconnu, 409 série terminée, 400 saisie invalide |
| `GET /api/tournament/servers` · `POST /api/tournament/servers` | Serveurs de jeu avec disponibilité (`free` / `busy` + match en cours / `disabled`) · enregistrer un serveur (`{ name: id de l'agent, ip, port?, game? }`) |
| `POST /api/tournament/servers/:id/disable` \| `enable` \| `release` | Désactiver un PC mort (jamais choisi) / le remettre en service / **libérer** un serveur bloqué sur un match qui ne finira jamais |
| `POST /api/tournament/matches/:id/games/:order/launch` | Lancer le game n° `order` d'une série sur un serveur choisi : `{ server, mapName, settings? }`. Le moteur temps réel utilise l'UUID du game comme matchId : le résultat remonte seul (game → série → arbre). Relancer sur un autre serveur après un crash = même appel. 409 si serveur désactivé / occupé / jeu différent |
| `GET /api/tournament/view` · `GET /api/tournament/tournaments/:id/view` | Pages **sans CSS ni JS** (un `<pre>`) : liste des tournois · vue ASCII d'un tournoi (poules, classements, arbres en colonnes, matchs, games, serveurs, qualifiés, matchs bonus) ; chaque libellé de match est un lien vers `GET /api/tournament/matches/:id/view` (détail : série, games avec auteur / serveur, stats joueurs, provenance et suite dans l'arbre, cliquables). `…/ascii` = texte brut, `…/overview` = JSON |
| `GET /api/matches/:id/review` | Résultat gelé (désaccord `Game Over` serveur / GG-Core) ou `null` |
| `POST /api/matches/:id/review/accept-server` \| `.../review/dismiss` | Décision admin : prendre le score du serveur et terminer le match (un nul reste un nul), ou lever le gel |
| `POST /api/matches/init` | Compat smoke tests CI (`matchId` dans le body) |
| `GET /api/matches/:id/players` | Joueurs du match |
| `GET /api/matches/:id/economy` | Économie |
| `GET/PATCH /api/matches/:id/sides`, `PATCH .../sides/swap` | Sides |
| `/sandbox`, `/sandbox/*` | Console Sandbox / Round Doctor : `inject`, `simulate/round-win`, `simulate/command`, `rcon`, `restore-ingame`, `replay/raw-log`, `replay/scenario`, `replay/rounds/start`, `replay/rounds/step`, `replay/rounds/:matchId`, `fixtures`, `state/:matchId`. Un replay pilote aussi le vrai serveur (voulu : reproduire un bug) ; il est refusé (409) si le serveur fait tourner **un autre** match non terminé |

CORS REST : origines autorisées via `CORS_ORIGIN` (liste séparée par des virgules, défaut `http://localhost:3000`).

#### WebSocket (`adapters/ws/`)
- `match.gateway.ts` — Socket.IO `/ws`, rooms `match:{id}:public` et `match:{id}:admin`
- `broadcaster.service.ts` — Subscribe `ggbot:events`, mappe vers `InternalEvent`, broadcast WS
- `socket.auth.guard.ts` — Guard JWT (role: admin/viewer)
- `dto/events.dto.ts` — `WsEventType` + tous les types WS typés
- Événements admin d'arbitrage : `match:review_required` (Game Over serveur ≠ GG-Core), `match:review_resolved`. Les comptes à rebours (`phase:countdown` / `phase:cancelled`) sont mappés dans les deux graphies (`:` et `_`)

#### Redis (`adapters/redis/`)
- Tokens d'injection : `REDIS_CMD`, `REDIS_PUB`, `REDIS_SUB`
- 3 clients distincts (commandes/lecture, publication, souscription)

#### Database (`adapters/database/`)
- `PrismaService` — Client Prisma connecté à PostgreSQL (gestion cycle de vie NestJS `onModuleInit`/`onModuleDestroy`)
- `DatabaseModule` — Module global exportant `PrismaService` et `TournamentPersistenceService`
- Modèles Prisma : `Tournament`, `Team`, `Player`, `TeamRoster`, `Server`, `Match`, `MatchVeto`, `MatchMap`, `PlayerMapStats`, `EventPrimary`

**Liaison moteur temps réel ↔ modèle relationnel**
- Les matchs temps réel ont des identifiants libres (`m-7ef15f093f`, `m-sandbox-1`) ; les tables relationnelles utilisent des **UUID**.
- `POST /api/matches/:id/init` avec `matchMapId` (UUID d'un `MatchMap`) pose `match:{id}:db_match_map`. À défaut, un matchId qui est lui-même l'UUID d'un `MatchMap` est accepté.
- `DatabaseEventsHandler` (asynchrone, non bloquant) :
  - écrit **toujours** l'événement dans `events_primary` avec `match_id` / `server_id`, et `match_map_id` seulement si la liaison est résolue (cache 30 s) ;
  - n'écrit les `PlayerMapStats` que si le `MatchMap` **et** l'UUID d'équipe (`teams.home_id/away_id`, via côté CT/T → home/away) sont connus.
- Fin de match : progression du bracket uniquement pour un `MatchMap` d'un match **BO1** (ou un matchId = UUID de `Match`) ; les séries BO3/BO5 ne sont pas avancées à la fin d'une map.
- Test d'intégration sur vraie base : `DB_IT=1 npx jest --config jest.config.ts event-sourcing.db` (les autres specs mockent Prisma).

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
