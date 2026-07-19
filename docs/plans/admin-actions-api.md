# Plan d'implémentation — API Admin Actions

> Statut : **Implémenté** (voir `backend/src/adapters/http/matches/admin-actions.controller.ts`,
> `backend/src/application/servers/agent-client.service.ts` méthode `adminAction`, et le handler
> `/admin-action` dans `agent/cmd/agent/main.go`). Ce document est conservé comme référence de conception ;
> se fier au code pour le détail exact (le contrôleur réel utilise `@Param('matchId')` et non `@Param('id')`,
> `Promise.all` pour résoudre `dbId`/`serverId` en parallèle).
> Priorité : P1
> Contexte explorateur : session Claude du 2026-05-04 — implémenté depuis

---

## Objectif

Exposer `POST /api/matches/:matchId/admin-actions` permettant à l'interface admin de
piloter un match en cours sans connaître les commandes CS2.

Le backend valide la requête, enregistre l'action en historique puis délègue à l'agent Go
qui traduit l'intention en RCON / fichiers cfg.

---

## Flux global

```
Frontend
  POST /api/matches/:matchId/admin-actions  { action, phase?, map?, score? }
Backend (NestJS)
  1. Valide matchId → getServerIdFromMatchId → si null : 404
  2. Valide payload
  3. findDbIdByRedisId → si null : 404
  4. historyRepo.insert({ event_type: 'admin:action', data: {...} })
  5. agentClient.adminAction(serverId, payload)
Agent Go
  POST /admin-action  { action, phase?, map?, score? }
  → RCON / exec cfg sur CS2
  → 204 No Content
Backend
  success : { success: true }
  erreur  : { success: false, error: { code, message } }   HTTP 200
```

---

## Actions supportées

| action | phase | score | map |
|---|---|---|---|
| `pause_match` | — | — | — |
| `unpause_match` | — | — | — |
| `set_game_phase` | `warmup` | — | — |
| `set_game_phase` | `knife` | — | — |
| `set_game_phase` | `match_start` | optionnel | — |
| `set_game_phase` | `overtime` | **obligatoire** | — |
| `set_game_phase` | `next_map` | — | **obligatoire** |

---

## 1. Backend — nouveau contrôleur

### Fichier à créer
`backend/src/adapters/http/matches/admin-actions.controller.ts`

### DTOs (inline, même pattern que series-create.controller.ts)

```typescript
class ScoreSideDto {
  team_id!: string;
  score!: number;     // entier >= 0
}
class ScoreDto {
  ct!: ScoreSideDto;
  t!: ScoreSideDto;
}
class AdminActionDto {
  action!: 'pause_match' | 'unpause_match' | 'set_game_phase';
  phase?: 'warmup' | 'knife' | 'match_start' | 'overtime' | 'next_map';
  map?: string;       // requis si phase='next_map'
  score?: ScoreDto;   // requis si phase='overtime'
}
class AdminActionResponseDto {
  success!: boolean;
  error?: { code: string; message: string };
}
```

### Validation (dans le handler, sans class-validator)

```typescript
const VALID_ACTIONS = ['pause_match', 'unpause_match', 'set_game_phase'];
const VALID_PHASES  = ['warmup', 'knife', 'match_start', 'overtime', 'next_map'];

if (!VALID_ACTIONS.includes(dto.action)) throw new BadRequestException('action invalide');

if (dto.action === 'set_game_phase') {
  if (!dto.phase || !VALID_PHASES.includes(dto.phase))
    throw new BadRequestException('phase invalide ou manquante');
  if (dto.phase === 'next_map' && !dto.map?.trim())
    throw new BadRequestException('map requise pour next_map');
  if (dto.phase === 'overtime' && !dto.score)
    throw new BadRequestException('score obligatoire pour overtime');
}

if (dto.score) {
  const { ct, t } = dto.score;
  if (!ct?.team_id || !t?.team_id)
    throw new BadRequestException('team_id manquant dans score');
  if (!Number.isInteger(ct.score) || ct.score < 0 ||
      !Number.isInteger(t.score)  || t.score  < 0)
    throw new BadRequestException('score doit être un entier >= 0');
  if (ct.team_id === t.team_id)
    throw new BadRequestException('ct.team_id et t.team_id doivent être différents');
}
```

### Corps du handler

```typescript
@ApiTags('matches')
@Controller('matches/:id/admin-actions')
export class MatchAdminActionsController {
  private readonly logger = new Logger(MatchAdminActionsController.name);

  constructor(
    private readonly matchState: MatchStateService,
    private readonly matchRepo: MatchRepository,
    private readonly historyRepo: MatchHistoryRepository,
    private readonly agentClient: AgentClientService,
  ) {}

  @Post()
  async execute(@Param('id') matchId: string, @Body() dto: AdminActionDto) {
    // validation …

    // 1. Vérifier le serveur lié
    const serverId = await this.matchState.getServerIdFromMatchId(matchId);
    if (!serverId) throw new NotFoundException(`Aucun serveur lié au match ${matchId}`);

    // 2. Vérifier le match en DB (pour l'historique)
    const dbId = await this.matchRepo.findDbIdByRedisId(matchId);
    if (dbId === null) throw new NotFoundException(`Match ${matchId} introuvable`);

    // 3. Historique AVANT l'appel agent
    await this.historyRepo.insert({
      id_match: dbId,
      event_type: 'admin:action',
      data: {
        action: dto.action,
        phase: dto.phase ?? null,
        map: dto.map ?? null,
        score: dto.score ?? null,
        serverId,
        requestedAt: new Date().toISOString(),
      },
    });

    // 4. Appel agent (synchrone)
    try {
      await this.agentClient.adminAction(serverId, {
        action: dto.action,
        phase: dto.phase,
        map: dto.map,
        score: dto.score,
      });
      return { success: true };
    } catch (err) {
      const message = (err as Error).message ?? String(err);
      const isTimeout = message.includes('aborted') || message.includes('timeout');
      this.logger.warn(`[${matchId}] admin-action échouée : ${message}`);
      return {
        success: false,
        error: {
          code: isTimeout ? 'AGENT_TIMEOUT' : 'AGENT_ERROR',
          message: isTimeout
            ? "L'action admin a été enregistrée mais l'agent n'a pas répondu à temps."
            : "L'action admin a été enregistrée mais l'agent n'a pas pu l'appliquer.",
        },
      };
    }
  }
}
```

---

## 2. Backend — AgentClientService

### Fichier à modifier
`backend/src/application/servers/agent-client.service.ts`

Ajouter la constante (ligne ~12) :
```typescript
const ADMIN_ACTION_TIMEOUT_MS = 30_000;
```

Ajouter la méthode après `initMatch` :
```typescript
async adminAction(
  serverId: string,
  payload: {
    action: string;
    phase?: string;
    map?: string;
    score?: {
      ct: { team_id: string; score: number };
      t:  { team_id: string; score: number };
    };
  },
): Promise<void> {
  const { baseUrl, token } = await this.resolve(serverId);
  const url = `${baseUrl}/admin-action`;
  this.log.debug(`[${serverId}] admin-action → ${url} payload=${JSON.stringify(payload)}`);
  const res = await fetch(url, {
    method: 'POST',
    headers: this.cmdHeaders(token),
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(ADMIN_ACTION_TIMEOUT_MS),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`agent /admin-action HTTP ${res.status}: ${text}`);
  }
  this.log.log(`[${serverId}] admin-action OK action=${payload.action} phase=${payload.phase ?? '-'}`);
}
```

---

## 3. Backend — http.module.ts

### Fichier à modifier
`backend/src/adapters/http/http.module.ts`

```typescript
import { MatchAdminActionsController } from './matches/admin-actions.controller';

// Dans controllers[] :
MatchAdminActionsController,
```

---

## 4. Backend — Tests unitaires

### Fichier à créer
`backend/src/adapters/http/matches/admin-actions.controller.spec.ts`

Pattern de mock :
```typescript
const mockMatchState   = { getServerIdFromMatchId: jest.fn() };
const mockMatchRepo    = { findDbIdByRedisId: jest.fn() };
const mockHistoryRepo  = { insert: jest.fn() };
const mockAgentClient  = { adminAction: jest.fn() };
```

| # | describe / it | Setup | Expect |
|---|---|---|---|
| 1 | action invalide | dto.action='invalid' | BadRequestException |
| 2 | phase manquante | action=set_game_phase, pas de phase | BadRequestException |
| 3 | phase invalide | phase='unknown' | BadRequestException |
| 4 | map manquante pour next_map | phase=next_map, pas de map | BadRequestException |
| 5 | score manquant pour overtime | phase=overtime, pas de score | BadRequestException |
| 6 | score.ct.score négatif | score.ct.score=-1 | BadRequestException |
| 7 | ct.team_id === t.team_id | même team_id des deux côtés | BadRequestException |
| 8 | match sans serveur | getServerIdFromMatchId→null | NotFoundException |
| 9 | match sans dbId | findDbIdByRedisId→null | NotFoundException |
| 10 | agent timeout | adminAction→AbortError | { success:false, code:'AGENT_TIMEOUT' } |
| 11 | agent erreur HTTP | adminAction→Error('HTTP 500') | { success:false, code:'AGENT_ERROR' } |
| 12 | pause_match succès | adminAction→resolves | history inséré + { success:true } |
| 13 | overtime + score | phase=overtime, score valide | agent appelé avec score complet |
| 14 | next_map + map | phase=next_map, map='de_dust2' | agent appelé avec map |

---

## 5. Agent Go — nouveau handler

### Fichier à modifier
`agent/cmd/agent/main.go`

#### a) Ajouter le type ScorePayload (avec les autres types, ~ligne 45)

```go
type AdminScorePayload struct {
    CT struct {
        TeamID string `json:"team_id"`
        Score  int    `json:"score"`
    } `json:"ct"`
    T struct {
        TeamID string `json:"team_id"`
        Score  int    `json:"score"`
    } `json:"t"`
}
```

#### b) Enregistrer le handler dans le mux (~ligne 410, après /unpause)

```go
mux.HandleFunc("/admin-action", handleAdminAction)
```

#### c) Écrire la fonction handler (après les autres handlers)

```go
func handleAdminAction(w http.ResponseWriter, r *http.Request) {
    if !checkCmdToken(w, r) || !requirePost(w, r) {
        return
    }

    var body struct {
        Action string              `json:"action"`
        Phase  string              `json:"phase,omitempty"`
        Map    string              `json:"map,omitempty"`
        Score  *AdminScorePayload  `json:"score,omitempty"`
    }
    if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
        http.Error(w, "invalid json", http.StatusBadRequest)
        return
    }

    ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
    defer cancel()

    var execErr error
    switch body.Action {
    case "pause_match":
        execErr = withRcon(ctx, func(c *rcon.Client) error {
            return execAction(ctx, c, &AgentAction{Action: "pause"})
        })
    case "unpause_match":
        execErr = withRcon(ctx, func(c *rcon.Client) error {
            return execAction(ctx, c, &AgentAction{Action: "unpause"})
        })
    case "set_game_phase":
        execErr = handleAdminPhase(ctx, body.Phase, body.Map, body.Score)
    default:
        http.Error(w, "action inconnue: "+body.Action, http.StatusBadRequest)
        return
    }

    if execErr != nil {
        if errors.Is(execErr, context.DeadlineExceeded) || errors.Is(execErr, context.Canceled) {
            http.Error(w, "timeout agent: "+execErr.Error(), http.StatusGatewayTimeout)
            return
        }
        http.Error(w, execErr.Error(), http.StatusInternalServerError)
        return
    }
    w.WriteHeader(http.StatusNoContent)
}

func handleAdminPhase(ctx context.Context, phase, mapName string, score *AdminScorePayload) error {
    switch phase {
    case "warmup":
        return withRcon(ctx, func(c *rcon.Client) error {
            return execAction(ctx, c, &AgentAction{
                Action:  "exec_cfg",
                Payload: AgentPayload{Name: "ggbot/warmup.cfg"},
            })
        })
    case "knife":
        return withRcon(ctx, func(c *rcon.Client) error {
            return execAction(ctx, c, &AgentAction{
                Action:  "exec_cfg",
                Payload: AgentPayload{Name: "ggbot/knife.cfg"},
            })
        })
    case "match_start":
        return withRcon(ctx, func(c *rcon.Client) error {
            matchId := getCachedMatchID()
            if err := execAction(ctx, c, &AgentAction{
                Action:  "exec_cfg",
                Payload: AgentPayload{Name: "ggbot/competitive.cfg", MatchID: matchId},
            }); err != nil {
                return err
            }
            if score != nil && (score.CT.Score != 0 || score.T.Score != 0) {
                log.Printf("[admin-action] WARN: score non-zéro (%d CT / %d T) — "+
                    "pas de commande CS2 vanilla pour appliquer un score arbitraire. "+
                    "Le match reprend à 0-0.", score.CT.Score, score.T.Score)
            }
            return nil
        })
    case "overtime":
        return withRcon(ctx, func(c *rcon.Client) error {
            matchId := getCachedMatchID()
            return execAction(ctx, c, &AgentAction{
                Action:  "exec_cfg",
                Payload: AgentPayload{Name: "ggbot/overtime.cfg", MatchID: matchId},
            })
        })
    case "next_map":
        if mapName == "" {
            return fmt.Errorf("map requise pour phase next_map")
        }
        return withRcon(ctx, func(c *rcon.Client) error {
            matchId := getCachedMatchID()
            return execAction(ctx, c, &AgentAction{
                Action:  "exec_cfg",
                Payload: AgentPayload{
                    Name:    "ggbot/init.cfg",
                    MatchID: matchId,
                    Vars:    map[string]string{"map": mapName},
                },
            })
        })
    default:
        return fmt.Errorf("phase inconnue: %s", phase)
    }
}
```

> **Note Go** : Si `withRcon` et `execAction` ont des signatures différentes de celles
> décrites ci-dessus, adapter à la signature réelle vue dans main.go. L'important est
> d'utiliser le verrou `rconMu` existant pour sérialiser les commandes.

---

## 6. Agent Go — overtime.cfg

### Fichier à créer
`agent/cfg/ggbot/overtime.cfg`

```cfg
// Overtime forcé par admin-action
mp_overtime_enable 1
mp_overtime_maxrounds 6
mp_overtime_startmoney 10000
mp_restartgame 1
```

---

## Notes techniques importantes

### Score en CS2 vanilla
Il n'existe pas de commande RCON native en CS2 pour forcer un score arbitraire.
- Score 0-0 : automatique après `mp_restartgame 1` dans competitive.cfg
- Score non-zéro : loggué comme WARN côté agent, match redémarre quand même à 0-0

Si un score exact est critique, il faudra un plugin SourceMod (hors scope V1).

### Sérialisation des actions
Le mutex `rconMu` existant dans l'agent sérialise déjà toutes les commandes RCON.
Aucune file d'attente supplémentaire n'est nécessaire.

### Timeout
- Backend → Agent : `AbortSignal.timeout(30_000)` dans `adminAction()`
- Agent → CS2 : `context.WithTimeout(r.Context(), 30*time.Second)` dans le handler

### Réponse agent
L'agent retourne `204 No Content` (pas de body). Les fonctions helper existantes
`writeOK()` écrivent un body JSON — ne pas les utiliser ici, écrire directement
`w.WriteHeader(http.StatusNoContent)`.

---

## Ordre d'implémentation recommandé

1. `agent/cfg/ggbot/overtime.cfg` (trivial, 4 lignes)
2. `backend/src/application/servers/agent-client.service.ts` (méthode `adminAction`)
3. `backend/src/adapters/http/matches/admin-actions.controller.ts` (controller complet)
4. `backend/src/adapters/http/http.module.ts` (enregistrement)
5. `backend/src/adapters/http/matches/admin-actions.controller.spec.ts` (tests)
6. `agent/cmd/agent/main.go` (handler + type + handleAdminPhase)
7. Build + test

---

## Commandes de test rapide

```bash
# Pause
curl -X POST http://localhost:8081/api/matches/m-xxxxx/admin-actions \
  -H "Content-Type: application/json" \
  -d '{"action":"pause_match"}'

# Passer en knife
curl -X POST http://localhost:8081/api/matches/m-xxxxx/admin-actions \
  -H "Content-Type: application/json" \
  -d '{"action":"set_game_phase","phase":"knife"}'

# Overtime avec score
curl -X POST http://localhost:8081/api/matches/m-xxxxx/admin-actions \
  -H "Content-Type: application/json" \
  -d '{
    "action":"set_game_phase",
    "phase":"overtime",
    "score":{
      "ct":{"team_id":"team-a","score":12},
      "t": {"team_id":"team-b","score":12}
    }
  }'

# Next map
curl -X POST http://localhost:8081/api/matches/m-xxxxx/admin-actions \
  -H "Content-Type: application/json" \
  -d '{"action":"set_game_phase","phase":"next_map","map":"de_inferno"}'
```
