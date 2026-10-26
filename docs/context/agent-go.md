# Agent Go — Contexte

## Rôle
Programme Go qui fait le lien entre un serveur CS2 et le backend.
- Reçoit les logs CS2 via HTTP (`logaddress_add_http`)
- Exécute des commandes RCON
- Publie les événements parsés sur Redis
- Écoute les actions Redis pour les exécuter sur le serveur

## Deux binaires

### Manager (`agent/cmd/manager/main.go`)
- Orchestre N agents (1 par serveur CS2)
- Watch `agents.d/*.yaml` via fsnotify → spawn/stop agents dynamiquement
- Resync Redis TTL au démarrage pour éviter les doublons
- Restart avec backoff exponentiel en cas de crash

### Agent (`agent/cmd/agent/main.go`)
- Un process par serveur CS2
- Serveur HTTP `/logs` (reçoit NDJSON de CS2)
- Client RCON (rate-limit, timeout)
- Heartbeat Redis TTL (`ggbot:agent:<serverId>:state`)
- Subscribe `ggbot:agent:<serverId>:actions` pour exécuter les commandes
- Publie événements sur `ggbot:events` (pub/sub) + `ggbot:events_primary:<serverId>` (stream)

## Packages internes

| Package | Fichier | Rôle |
|---------|---------|------|
| events | `internal/events/events.go` | Types d'événements (EventType, BaseEvent, payloads) |
| rcon | `internal/rcon/client.go` | Client RCON avec rate-limit et timeout |
| execfg | `internal/execfg/execcfg.go` | Exécute des fichiers .cfg (directives @sleep/@include, vars ${x}) |
| execfg | `internal/execfg/resolver.go` | Résout les chemins de fichiers .cfg |
| ingest | `internal/ingest/batcher.go` | Batch logs (MaxLines, MaxBytes, MaxDelayMs) avant POST backend |
| ingest | `internal/ingest/httpLogs/http.go` | Serveur HTTP POST /logs (token auth) |
| parser | `internal/parser/parser.go` | 80+ regex → parse logs CS2 vers événements typés |
| stream | `internal/stream/writer.go` | Écrit vers Redis Stream (XADD) |

## Configuration YAML (`agents.d/srv-a.yaml`)
```yaml
version: 1
serverId: srv-a
cs2:
  addr: 172.21.192.1:27015
  rconPassword: "123456"
  rcon:
    connectTimeoutMs: 2000
    commandTimeoutMs: 2000
    rateLimitPerSec: 6
logs:
  bind: "0.0.0.0:8082"
  token: secret
  backendPostUrl: "http://backend:8081/cs2/logs"
  batch: { maxLines: 100, maxDelayMs: 75 }
  retry: { baseMs: 1000, maxMs: 30000, jitter: true, maxBufferLines: 10000 }
redis:
  url: "redis://redis:6379"
  actionsChannel: "ggbot:agent:srv-a:actions"
  stateKey: "ggbot:agent:srv-a:state"
  stateTtlSec: 10
```

## Actions Redis reçues par l'agent (`ggbot:agent:<serverId>:actions`)
- `pause` / `unpause`
- `say` — message ingame
- `changelevel` — changer de map
- `exec_cfg` — exécuter un fichier .cfg
- `restart` — mp_restartgame

## Fichiers .cfg disponibles
- `agent/cfg/ggbot/knife.cfg` — 1 round, 5min, pas d'achat, couteau uniquement
- `agent/cfg/ggbot/knife_undo.cfg` — annule knife
- `agent/cfg/ggbot/warmup.cfg` — warmup

## Flow de données
```
CS2 --logaddress_add_http--> Agent HTTP /logs
                                  |
                             Parser (80+ regex)
                                  |
                              Batcher
                                  |
                    ┌─────────────┴──────────────┐
                    │                            │
          Redis XADD Stream            Redis PUBLISH ggbot:events
    ggbot:events_primary:<sid>
```

## Structs Go importants
- `AgentConfig` : serverId, CS2, Logs, Redis, CSTV
- `AgentAction` : type, serverId, action, payload (matchId, teamLogical, teamSide, seconds, message, map, name, vars)
- `BusEvent` : v, id, timestamp, type, matchId, serverId, source, kind, payload
- `HeartbeatPayload` : ts, rcon.connected, logs.ok, queue, dropped
