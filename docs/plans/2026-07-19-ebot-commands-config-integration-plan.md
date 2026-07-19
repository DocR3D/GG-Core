# eBot Commands & Config Integration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a named agent-side API for phase-start RCON sequences (warmup/knife/live), fix the
resulting warmup/knife/live execution bugs, and add `!restart` (knife round re-vote) and
`!stop`/`!continue` (match stop re-vote) chat commands to GG-Core.

**Architecture:** Three new named HTTP endpoints on the Go agent (`/warmup-start`, `/knife-start`,
`/live-start`) replace ad-hoc RCON strings and a fragile filename-sniffing special case currently
scattered across three NestJS rule files. `!restart` reuses the existing phase-countdown machinery
plus one new small `MatchVoteService` for per-team vote tallying. `!stop`/`!continue` reuse the
existing `PauseMatchService`/`MatchCommandsService` pause/unpause plumbing directly (same pattern as
the already-wired `!pause`/`!tech` commands), plus the same `MatchVoteService`.

**Tech Stack:** Go 1.24 (agent), NestJS v10 / TypeScript (backend), Jest + ts-jest (tests), Redis (ioredis).

**Reference:** `docs/specs/2026-07-19-ebot-commands-config-integration-design.md` (approved design spec).

## Global Constraints
- Alias TypeScript : `@app` → `src/application`, `@adapters` → `src/adapters`, `@domain` → `src/domain`
- Tests colocalisés avec le fichier source (`x.spec.ts` à côté de `x.ts`)
- Commits : préfixe conventionnel (`fix:`, `feat:`, `test:`, `refactor:`) + description en français
- Ne jamais commiter `agents.d/*.yaml` avec de vrais secrets, ni `.claude/`
- Ne pas utiliser `it.failing` — un bug non corrigé se documente avec `// TODO BUG Bxx : <explication>`
- Backend, vérif rapide ciblée : `cd backend && npm run typecheck` puis `npm test -- <fichier.spec.ts>`
- Agent Go, vérif rapide ciblée : `cd agent && go build ./cmd/agent`
- Vérif globale (fin de plan uniquement) : `./scripts/check.sh --no-smoke` depuis la racine

---

### Task 1: Agent — endpoints `/warmup-start` et `/knife-start`

**Files:**
- Modify: `agent/cmd/agent/main.go:420` (juste après le bloc `/unpause`, avant `/admin-action`)

**Interfaces:**
- Consumes: helpers déjà existants dans `runLogsHTTP` — `requirePost`, `checkCmdToken`, `execHTTP` (closures définies lignes 291-319), struct `AgentAction{Action, Payload{Name, Vars, Message, Map}}`
- Produces: endpoints HTTP `POST /warmup-start` et `POST /knife-start` (body `{}`, réponse `{"ok":true}` via `writeOK`), consommés par `AgentClientService` (Task 3)

- [ ] **Step 1: Ajouter les deux handlers**

Dans `agent/cmd/agent/main.go`, juste après le bloc `/unpause` (qui se termine ligne 420 par `})`),
insérer :

```go
	// POST /warmup-start  {}
	mux.HandleFunc("/warmup-start", func(w http.ResponseWriter, r *http.Request) {
		if !requirePost(w, r) || !checkCmdToken(w, r) {
			return
		}
		act := &AgentAction{Action: "exec_cfg"}
		act.Payload.Name = "ggbot/warmup.cfg"
		execHTTP(w, r, act)
	})

	// POST /knife-start  {}
	mux.HandleFunc("/knife-start", func(w http.ResponseWriter, r *http.Request) {
		if !requirePost(w, r) || !checkCmdToken(w, r) {
			return
		}
		act := &AgentAction{Action: "exec_cfg"}
		act.Payload.Name = "ggbot/knife.cfg"
		execHTTP(w, r, act)
	})
```

- [ ] **Step 2: Vérifier la compilation**

Run: `cd agent && go build ./cmd/agent`
Expected: aucune erreur, exécutable généré (le binaire peut être supprimé après, on ne le commite pas)

- [ ] **Step 3: Test manuel (nécessite un agent lancé et joignable)**

```bash
curl -X POST http://localhost:8082/warmup-start -H "X-Agent-Token: <token>"
curl -X POST http://localhost:8082/knife-start -H "X-Agent-Token: <token>"
```
Expected: `{"ok":true}` sur chaque appel, et dans les logs de l'agent une ligne `[agent:...] exec_cfg ggbot/warmup.cfg` (ou `knife.cfg`) suivie d'un succès RCON. Si aucun serveur CS2 n'est disponible localement, documenter que ce step est différé au Task 12 (smoke test global).

- [ ] **Step 4: Commit**

```bash
git add agent/cmd/agent/main.go
git commit -m "feat(agent): ajoute les endpoints nommés /warmup-start et /knife-start"
```

---

### Task 2: Agent — endpoint `/live-start` + suppression du cas spécial dans `/exec`

**Files:**
- Modify: `agent/cmd/agent/main.go` (ajout d'un nouveau handler, suppression d'un bloc dans `/exec`)

**Interfaces:**
- Consumes: `execAction(ctx context.Context, cfg AgentConfig, act *AgentAction) error` (fonction top-level,
  ligne 629), `rdb *redis.Client` (paramètre de `runLogsHTTP`, déjà en closure), `cfg AgentConfig` (idem)
- Produces: `POST /live-start` `{"matchId":"m-xxx","delay":3}` → 204/erreur, consommé par
  `AgentClientService.liveStart()` (Task 3)

- [ ] **Step 1: Ajouter le handler `/live-start`**

Insérer juste après le bloc `/knife-start` ajouté au Task 1 :

```go
	// POST /live-start  {"matchId":"m-xxx","delay":3}
	mux.HandleFunc("/live-start", func(w http.ResponseWriter, r *http.Request) {
		if !requirePost(w, r) || !checkCmdToken(w, r) {
			return
		}
		var body struct {
			MatchID string `json:"matchId"`
			Delay   int    `json:"delay,omitempty"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			http.Error(w, "invalid json", http.StatusBadRequest)
			return
		}
		if body.Delay <= 0 {
			body.Delay = 3
		}

		ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
		defer cancel()

		// 1. Réglages compétitifs (fichier custom GG-Core, pas les fichiers natifs CS2)
		cfgAct := &AgentAction{Action: "exec_cfg"}
		cfgAct.Payload.Name = "ggbot/competitive.cfg"
		if err := execAction(ctx, cfg, cfgAct); err != nil {
			log.Printf("[agent:%s] /live-start competitive.cfg error: %v", cfg.ServerID, err)
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		// 2. Overtime depuis matchConfig Redis
		if body.MatchID != "" && rdb != nil {
			cfgKey := "match:" + body.MatchID + ":config"
			val, _ := rdb.HGet(ctx, cfgKey, "overtimeEnabled").Result()
			otCmd := "mp_overtime_enable 0"
			if val == "1" {
				otCmd = "mp_overtime_enable 1"
			}
			log.Printf("[agent:%s] live-start overtime override: %s (matchId=%s)", cfg.ServerID, otCmd, body.MatchID)
			otAct := &AgentAction{Action: "rcon"}
			otAct.Payload.Message = otCmd
			if err := execAction(ctx, cfg, otAct); err != nil {
				log.Printf("[agent:%s] /live-start overtime RCON error: %v", cfg.ServerID, err)
			}
		}

		// 3. Warmup off (filet de sécurité) + restart
		endAct := &AgentAction{Action: "rcon"}
		endAct.Payload.Message = "mp_warmup_end"
		if err := execAction(ctx, cfg, endAct); err != nil {
			log.Printf("[agent:%s] /live-start mp_warmup_end error: %v", cfg.ServerID, err)
		}

		restartAct := &AgentAction{Action: "rcon"}
		restartAct.Payload.Message = fmt.Sprintf("mp_restartgame %d", body.Delay)
		if err := execAction(ctx, cfg, restartAct); err != nil {
			log.Printf("[agent:%s] /live-start restart error: %v", cfg.ServerID, err)
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeOK(w)
	})
```

- [ ] **Step 2: Supprimer le cas spécial `competitive` dans le handler `/exec`**

Dans le handler `/exec` (autour de la ligne 500-544 avant modification), supprimer ce bloc :

```go
		// 2. Après competitive.cfg → envoyer mp_overtime_enable depuis matchConfig Redis
		if strings.Contains(body.Name, "competitive") && body.MatchID != "" && rdb != nil {
			cfgKey := "match:" + body.MatchID + ":config"
			val, _ := rdb.HGet(r.Context(), cfgKey, "overtimeEnabled").Result()
			otCmd := "mp_overtime_enable 0" // défaut : off
			if val == "1" {
				otCmd = "mp_overtime_enable 1"
			}
			log.Printf("[agent:%s] knife_undo → overtime override: %s (matchId=%s)", cfg.ServerID, otCmd, body.MatchID)
			otAct := &AgentAction{Action: "rcon"}
			otAct.ServerID = cfg.ServerID
			otAct.Payload.Message = otCmd
			if err := execAction(r.Context(), cfg, otAct); err != nil {
				log.Printf("[agent:%s] overtime RCON error: %v", cfg.ServerID, err)
			}
		}

```
Le handler `/exec` doit donc se réduire à : décoder le body → exécuter `exec_cfg` → `writeOK(w)`
(cette logique est désormais dans `/live-start` uniquement).

- [ ] **Step 3: Vérifier la compilation**

Run: `cd agent && go build ./cmd/agent`
Expected: aucune erreur. Si `strings` n'est plus utilisé ailleurs dans le fichier après suppression du
bloc, le compilateur Go signalera un import inutilisé (`"strings" imported and not used`) — vérifier
avec `grep -n "strings\." agent/cmd/agent/main.go` ; si d'autres usages restent (ex: `splitLines`
utilise `strings.ReplaceAll`/`strings.Split`/`strings.TrimSpace`), l'import reste nécessaire et il n'y
a rien à faire.

- [ ] **Step 4: Test manuel**

```bash
curl -X POST http://localhost:8082/live-start \
  -H "X-Agent-Token: <token>" -H "Content-Type: application/json" \
  -d '{"matchId":"m-test","delay":3}'
```
Expected: `{"ok":true}`, logs agent montrant `exec_cfg ggbot/competitive.cfg` puis l'override overtime
puis `mp_warmup_end` puis `mp_restartgame 3`.

- [ ] **Step 5: Commit**

```bash
git add agent/cmd/agent/main.go
git commit -m "feat(agent): ajoute /live-start, retire le cas special competitive de /exec"
```

---

### Task 3: Backend — `AgentClientService` : nouvelles méthodes HTTP

**Files:**
- Modify: `backend/src/application/servers/agent-client.service.ts:190` (juste avant l'accolade
  fermante de la classe, après la méthode `adminAction`)

**Interfaces:**
- Consumes: `this.resolve(serverId)` (méthode privée existante, retourne `{baseUrl, token}`),
  `this.cmdHeaders(token)`, `fetch` avec `AbortSignal.timeout`
- Produces: `warmupStart(serverId: string): Promise<void>`, `knifeStart(serverId: string): Promise<void>`,
  `liveStart(serverId: string, matchId: string, delay?: number): Promise<void>` — consommées par
  `MatchCommandsService` (Task 4)

- [ ] **Step 1: Ajouter les 3 méthodes**

Dans `backend/src/application/servers/agent-client.service.ts`, juste avant le `}` final de la classe
`AgentClientService` (après la méthode `adminAction`), ajouter :

```typescript
  // ─── POST /warmup-start ──────────────────────────────────────────────────

  async warmupStart(serverId: string): Promise<void> {
    const { baseUrl, token } = await this.resolve(serverId);
    await this.post(baseUrl, token, '/warmup-start', {});
    this.log.log(`[${serverId}] warmup-start`);
  }

  // ─── POST /knife-start ───────────────────────────────────────────────────

  async knifeStart(serverId: string): Promise<void> {
    const { baseUrl, token } = await this.resolve(serverId);
    await this.post(baseUrl, token, '/knife-start', {});
    this.log.log(`[${serverId}] knife-start`);
  }

  // ─── POST /live-start ────────────────────────────────────────────────────

  async liveStart(serverId: string, matchId: string, delay = 3): Promise<void> {
    const { baseUrl, token } = await this.resolve(serverId);
    await this.post(baseUrl, token, '/live-start', { matchId, delay });
    this.log.log(`[${serverId}] live-start matchId=${matchId}`);
  }
```

- [ ] **Step 2: Vérifier le typecheck**

Run: `cd backend && npm run typecheck`
Expected: aucune erreur TypeScript

- [ ] **Step 3: Commit**

```bash
git add backend/src/application/servers/agent-client.service.ts
git commit -m "feat(backend): ajoute warmupStart/knifeStart/liveStart au client agent"
```

---

### Task 4: Backend — `MatchCommandsService` : nouvelles méthodes + suppression du code mort

**Files:**
- Modify: `backend/src/application/commands/match-commands.service.ts`

**Interfaces:**
- Consumes: `AgentClientService.warmupStart/knifeStart/liveStart` (Task 3), `this.resolveServerAndMatch`
  (méthode privée déjà existante)
- Produces: `warmupStart(opts)`, `knifeStart(opts)`, `startLive(opts)` — consommées par
  `MatchOrchestrator` (Task 5)

- [ ] **Step 1: Supprimer les 4 stubs morts en tête de classe**

Supprimer ces 4 lignes (juste après `export class MatchCommandsService {`) :
```typescript
  runPostgame(matchId: string, serverId: string | undefined) {}
  runOvertime(matchId: string, serverId: string | undefined) {}
  runHalftime(matchId: string, serverId: string | undefined) {}
  runLive(matchId: string, serverId: string | undefined) {}
```
Vérifié : aucun appelant dans tout le repo (grep confirmé pendant la conception).

- [ ] **Step 2: Supprimer l'ancien `startLive()` (alias mort d'unpause) et `stopMatch()` (jamais câblé, dangereux)**

Supprimer ces deux méthodes :
```typescript
  async startLive(opts: { serverId?: string; matchId?: string; actor?: Actor }) {
    const { serverId, matchId } = await this.resolveServerAndMatch(opts);
    await this.unpause({ serverId, matchId, actor: opts.actor });
    return { ok: true };
  }
```
et
```typescript
  async stopMatch(opts: { serverId?: string; matchId?: string; actor?: Actor }) {
    const { serverId, matchId } = await this.resolveServerAndMatch(opts);
    await this.ms.setPhase(matchId, 'postgame');
    await this.say(serverId, '[match] stopped by admin');
    return { ok: true };
  }
```

- [ ] **Step 3: Ajouter les 3 nouvelles méthodes**

Ajouter, juste après la méthode `initMatch` existante :

```typescript
  async warmupStart(opts: { serverId?: string; matchId?: string }) {
    const { serverId } = await this.resolveServerAndMatch(opts);
    await this.agentClient.warmupStart(serverId);
    return { ok: true };
  }

  async knifeStart(opts: { serverId?: string; matchId?: string }) {
    const { serverId } = await this.resolveServerAndMatch(opts);
    await this.agentClient.knifeStart(serverId);
    return { ok: true };
  }

  async startLive(opts: { serverId?: string; matchId?: string; delay?: number }) {
    const { serverId, matchId } = await this.resolveServerAndMatch(opts);
    await this.agentClient.liveStart(serverId, matchId, opts.delay);
    return { ok: true };
  }
```

- [ ] **Step 4: Vérifier le typecheck**

Run: `cd backend && npm run typecheck`
Expected: aucune erreur (en particulier aucune référence résiduelle à `runPostgame`/`runOvertime`/
`runHalftime`/`runLive`/l'ancien `startLive`/`stopMatch` ailleurs dans le repo — si le typecheck échoue
sur un import manquant de ces méthodes, chercher l'appelant avec grep et le mettre à jour, mais aucun
appelant n'a été trouvé pendant la conception).

- [ ] **Step 5: Commit**

```bash
git add backend/src/application/commands/match-commands.service.ts
git commit -m "refactor(backend): ajoute warmupStart/knifeStart/startLive, retire le code mort (stopMatch, stubs, ancien startLive)"
```

---

### Task 5: Backend — `MatchOrchestrator` : `startWarmup`/`startKnife`/`startLive`

**Files:**
- Modify: `backend/src/application/match/match-orchestrator.service.ts:378-380`

**Interfaces:**
- Consumes: `MatchCommandsService.warmupStart/knifeStart/startLive` (Task 4), `this.resolve(ids)`
  (méthode privée déjà existante ligne 58)
- Produces: `MatchOrchestrator.startWarmup(ids)`, `.startKnife(ids)`, `.startLive(ids, delay?)` —
  consommées par `KnifeRule`/`WarmupRule`/`LiveRule` (Tasks 6-8)

- [ ] **Step 1: Remplacer `startWarmup` et ajouter `startKnife`/`startLive`**

Remplacer :
```typescript
  startWarmup(serverId: string) {
    this.cmds.rcon({serverId,command: "mp_warmup_start"})
  }
```
par :
```typescript
  async startWarmup(ids: { serverId?: string; matchId?: string }) {
    const { serverId, matchId } = await this.resolve(ids);
    return this.cmds.warmupStart({ serverId, matchId });
  }

  async startKnife(ids: { serverId?: string; matchId?: string }) {
    const { serverId, matchId } = await this.resolve(ids);
    return this.cmds.knifeStart({ serverId, matchId });
  }

  async startLive(ids: { serverId?: string; matchId?: string }, delay?: number) {
    const { serverId, matchId } = await this.resolve(ids);
    return this.cmds.startLive({ serverId, matchId, delay });
  }
```

> Note : `startWarmup` change de signature (`serverId: string` → `ids: {serverId?; matchId?}`) et
> devient asynchrone. Le seul appelant actuel est `knife.rule.ts:156` (`ctx.orch.startWarmup(ctx.serverId)`),
> corrigé au Task 6 en `ctx.orch.startWarmup({ serverId: ctx.serverId })`. Le mock dans
> `knife.rule.spec.ts` (`startWarmup: jest.fn().mockResolvedValue(undefined)`) reste valide tel quel
> (un mock Jest accepte n'importe quels arguments).

- [ ] **Step 2: Vérifier le typecheck**

Run: `cd backend && npm run typecheck`
Expected: erreur attendue à ce stade sur `knife.rule.ts:156` (`ctx.orch.startWarmup(ctx.serverId)` —
signature incompatible, `string` au lieu de `{serverId?}`) — c'est normal, corrigé au Task 6. Si
c'est la SEULE erreur reportée, continuer ; sinon investiguer les erreurs supplémentaires.

- [ ] **Step 3: Commit**

```bash
git add backend/src/application/match/match-orchestrator.service.ts
git commit -m "feat(backend): startWarmup accepte ids + ajoute startKnife/startLive sur MatchOrchestrator"
```

---

### Task 6: Backend — `KnifeRule` : utilise les nouveaux endpoints, retire les appels prématurés à competitive.cfg

**Files:**
- Modify: `backend/src/application/match/rules/knife.rule.ts`
- Modify: `backend/src/application/match/rules/knife.rule.spec.ts`

**Interfaces:**
- Consumes: `MatchOrchestrator.startKnife(ids)`, `.startWarmup(ids)` (Task 5)
- Produces: `KnifeRule.onEnter`/`onTeamRoundWin` n'appellent plus `execCfg` — comportement consommé
  implicitement par la transition de phase existante (aucun nouveau symbole public)

- [ ] **Step 1: Modifier `onEnter` — remplacer `execCfg('ggbot/knife.cfg')` par `startKnife`**

Remplacer, dans `onEnter(ctx: RuleContext)` :
```typescript
    await ctx.orch.execCfg({ serverId, matchId: ctx.matchId}, 'ggbot/knife.cfg');
```
par :
```typescript
    await ctx.orch.startKnife({ serverId, matchId: ctx.matchId });
```

- [ ] **Step 2: Modifier `onTeamRoundWin` — retirer les 2 appels prématurés à `competitive.cfg`, corriger `startWarmup`**

Dans le bloc fallback (sans state en mémoire), remplacer :
```typescript
    try {
      await ctx.orch.applyKnifeResult(ev.matchId, winnerFromEvent);
      await ctx.orch.execCfg({ serverId, matchId: ev.matchId}, 'ggbot/competitive.cfg' );
      await ctx.orch.startPhaseCountdown(ev.matchId, MatchPhase.KNIFE_CHOICE, 0, serverId);
    } catch (e) {
```
par :
```typescript
    try {
      await ctx.orch.applyKnifeResult(ev.matchId, winnerFromEvent);
      await ctx.orch.startPhaseCountdown(ev.matchId, MatchPhase.KNIFE_CHOICE, 0, serverId);
    } catch (e) {
```

Dans le chemin principal (avec state), remplacer :
```typescript
  // Retire le cfg knife, puis transition vers KNIFE_CHOICE
  try {
    await ctx.orch.execCfg({ serverId, matchId: ev.matchId}, 'ggbot/competitive.cfg');
  } catch (e) {
    await ctx.say(`[knife][warn] competitive.cfg KO: ${(e as Error)?.message ?? e}`);
  }

  // Verrouille et nettoie l'état pour éviter des doubles traitements
  (st as any).finished = true;
  this.state.delete(ev.matchId);
  if(!ctx.serverId) ctx.serverId = await ctx.state.getServerIdFromMatchId(ev.matchId)
  if(ctx.serverId) ctx.orch.startWarmup(ctx.serverId);
```
par :
```typescript
  // Verrouille et nettoie l'état pour éviter des doubles traitements
  (st as any).finished = true;
  this.state.delete(ev.matchId);
  if(!ctx.serverId) ctx.serverId = await ctx.state.getServerIdFromMatchId(ev.matchId)
  if(ctx.serverId) await ctx.orch.startWarmup({ serverId: ctx.serverId, matchId: ev.matchId });
```

> `ggbot/competitive.cfg` n'est désormais appliqué que depuis `LiveRule.onEnter()` (Task 8), via
> `/live-start`. `startWarmup` ici relance le warmup CS2 (mp_warmup_start via `warmup.cfg`) pendant que
> les joueurs choisissent `!stay`/`!switch` en `KNIFE_CHOICE` — comportement inchangé, juste re-câblé.

- [ ] **Step 3: Mettre à jour `knife.rule.spec.ts`**

Dans `baseCtx()`, ajouter `startKnife` au mock `orch` (garder `execCfg` n'est plus nécessaire mais ne
gêne pas — le retirer pour éviter la confusion) :
```typescript
    orch: {
      startKnife: jest.fn().mockResolvedValue(undefined),
      push: jest.fn().mockResolvedValue(undefined),
      applyKnifeResult: jest.fn().mockResolvedValue(undefined),
      startPhaseCountdown: jest.fn().mockResolvedValue(undefined),
      startWarmup: jest.fn().mockResolvedValue(undefined),
      sideToLogical: jest.fn().mockImplementation((_matchId: string, side: string) =>
        Promise.resolve(side === 'CT' ? 'home' : 'away'),
      ),
      logicalToSide: jest.fn().mockImplementation((_matchId: string, logical: string) =>
        Promise.resolve(logical === 'home' ? 'CT' : 'T'),
      ),
    },
```

Dans le premier test (`'initialise le state lors du onEnter'`), remplacer :
```typescript
    expect(ctx.orch.execCfg).toHaveBeenCalledWith(
      expect.objectContaining({ serverId: SERVER_ID }),
      'ggbot/knife.cfg',
    );
```
par :
```typescript
    expect(ctx.orch.startKnife).toHaveBeenCalledWith(
      expect.objectContaining({ serverId: SERVER_ID }),
    );
```

Dans le deuxième test (`'CT gagne : ...'`), supprimer entièrement ces 4 lignes (l'assertion sur
`competitive.cfg` n'a plus lieu d'être, l'appel a été retiré à l'étape 2) :
```typescript
    expect(ctx.orch.execCfg).toHaveBeenCalledWith(
      expect.objectContaining({ serverId: SERVER_ID }),
      'ggbot/competitive.cfg',
    );
```

- [ ] **Step 4: Lancer les tests ciblés**

Run: `cd backend && npm test -- src/application/match/rules/knife.rule.spec.ts`
Expected: `PASS`, tous les tests de `knife.rule.spec.ts` verts

- [ ] **Step 5: Vérifier le typecheck global**

Run: `cd backend && npm run typecheck`
Expected: aucune erreur (l'erreur de Task 5 Step 2 sur `knife.rule.ts:156` doit avoir disparu)

- [ ] **Step 6: Commit**

```bash
git add backend/src/application/match/rules/knife.rule.ts backend/src/application/match/rules/knife.rule.spec.ts
git commit -m "fix(backend): KnifeRule utilise startKnife/startWarmup, retire les doubles applications de competitive.cfg"
```

---

### Task 7: Backend — `WarmupRule` : retirer l'application redondante de competitive.cfg

**Files:**
- Modify: `backend/src/application/match/rules/warmup.rule.ts`
- Create: `backend/src/application/match/rules/warmup.rule.spec.ts`

**Interfaces:**
- Consumes: rien de nouveau (retire un appel existant)
- Produces: rien de nouveau — comportement de `launchAfterReady()` simplifié

- [ ] **Step 1: Écrire le test qui documente le comportement attendu (avant modification)**

Créer `backend/src/application/match/rules/warmup.rule.spec.ts` :
```typescript
/**
 * Tests unitaires — WarmupRule
 * Vérifie que launchAfterReady() ne ré-applique plus competitive.cfg pour les maps
 * non-décisives (c'est désormais LiveRule.onEnter, via /live-start, qui s'en charge).
 */
import { WarmupRule } from './warmup.rule';
import { MatchPhase } from '@domain/phase.types';

const MATCH_ID = 'm-test';
const SERVER_ID = 'srv-a';

function makeReadyCmd() {
  return { handle: jest.fn().mockResolvedValue(true) } as any;
}

function makeCtx(isDecidingMap: boolean) {
  return {
    matchId: MATCH_ID,
    serverId: SERVER_ID,
    say: jest.fn().mockResolvedValue(undefined),
    pubEvent: jest.fn().mockResolvedValue(undefined),
    orch: {
      execCfg: jest.fn().mockResolvedValue(undefined),
      startPhaseCountdown: jest.fn().mockResolvedValue(undefined),
      isBothReady: jest.fn().mockResolvedValue(true),
    },
    state: {
      getMatchConfig: jest.fn().mockResolvedValue({ isDecidingMap }),
      getServerIdFromMatchId: jest.fn().mockResolvedValue(SERVER_ID),
      clearRdyPlayers: jest.fn().mockResolvedValue(undefined),
      getSnapshot: jest.fn().mockResolvedValue({}),
    },
  } as any;
}

describe('WarmupRule.launchAfterReady — map non-décisive', () => {
  it("ne ré-applique plus competitive.cfg, se contente du countdown LIVE_MAIN", async () => {
    const rule = new WarmupRule(makeReadyCmd());
    const ctx = makeCtx(false);

    await (rule as any).launchAfterReady(MATCH_ID, SERVER_ID, ctx);

    expect(ctx.orch.execCfg).not.toHaveBeenCalled();
    expect(ctx.orch.startPhaseCountdown).toHaveBeenCalledWith(
      MATCH_ID,
      MatchPhase.LIVE_MAIN,
      5,
      SERVER_ID,
    );
  });

  it("map décisive : déclenche le countdown vers KNIFE_LIVE (comportement inchangé)", async () => {
    const rule = new WarmupRule(makeReadyCmd());
    const ctx = makeCtx(true);

    await (rule as any).launchAfterReady(MATCH_ID, SERVER_ID, ctx);

    expect(ctx.orch.startPhaseCountdown).toHaveBeenCalledWith(
      MATCH_ID,
      MatchPhase.KNIFE_LIVE,
      5,
      SERVER_ID,
    );
    expect(ctx.orch.execCfg).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Lancer le test et vérifier qu'il échoue (le comportement actuel appelle encore execCfg)**

Run: `cd backend && npm test -- src/application/match/rules/warmup.rule.spec.ts`
Expected: FAIL sur le premier test (`ne ré-applique plus competitive.cfg...`) — `execCfg` est
actuellement appelé dans la branche map non-décisive

- [ ] **Step 3: Modifier `launchAfterReady`**

Remplacer :
```typescript
      } else {
        // Applique les settings compétitifs sans passer par le knife round
        // Go gère automatiquement mp_overtime_enable selon matchConfig.overtimeEnabled
        await ctx.orch.execCfg({ matchId, serverId: srv }, 'ggbot/competitive.cfg');
        await ctx.orch.startPhaseCountdown(matchId, MatchPhase.LIVE_MAIN, 5, srv);
      }
```
par :
```typescript
      } else {
        // Les réglages compétitifs sont désormais appliqués par LiveRule.onEnter() (/live-start)
        await ctx.orch.startPhaseCountdown(matchId, MatchPhase.LIVE_MAIN, 5, srv);
      }
```

- [ ] **Step 4: Relancer le test et vérifier qu'il passe**

Run: `cd backend && npm test -- src/application/match/rules/warmup.rule.spec.ts`
Expected: PASS (les deux tests verts)

- [ ] **Step 5: Commit**

```bash
git add backend/src/application/match/rules/warmup.rule.ts backend/src/application/match/rules/warmup.rule.spec.ts
git commit -m "fix(backend): WarmupRule ne double plus l'application de competitive.cfg"
```

---

### Task 8: Backend — `LiveRule` : corrige le bug principal (fichier natif CS2 au lieu de ggbot/competitive.cfg)

**Files:**
- Modify: `backend/src/application/match/rules/live.rule.ts`
- Modify: `backend/src/application/match/rules/live.rule.spec.ts`

**Interfaces:**
- Consumes: `MatchOrchestrator.startLive(ids)` (Task 5)
- Produces: `LiveRule.onEnter` applique désormais `ggbot/competitive.cfg` (via `/live-start`) au lieu
  des fichiers natifs CS2 — c'est le fix du bug n°1 identifié dans le spec

- [ ] **Step 1: Modifier `onEnter`**

Remplacer :
```typescript
  async onEnter(ctx: RuleContext) {
    const serverId = ctx.serverId ?? (await ctx.state.getServerIdFromMatchId(ctx.matchId));
    if (!serverId) throw new Error(`Aucun serveur lié au match ${ctx.matchId}`);

    await ctx.orch.rcon({
      serverId,
      matchId: ctx.matchId,
      command: 'exec gamemode_competitive.cfg; exec gamemode_competitive_tmm; mp_warmup_end 1',
    });
    await ctx.orch.restartGame({ serverId, matchId: ctx.matchId, delay: 3 });

    await ctx.say('[live] Passage en phase LIVE.');
    await ctx.orch.push(ctx.matchId, 'match:state', await ctx.state.getSnapshot(ctx.matchId));
    ctx.orch.setPhase(ctx.matchId, "live_main")
  }
```
par :
```typescript
  async onEnter(ctx: RuleContext) {
    const serverId = ctx.serverId ?? (await ctx.state.getServerIdFromMatchId(ctx.matchId));
    if (!serverId) throw new Error(`Aucun serveur lié au match ${ctx.matchId}`);

    await ctx.orch.startLive({ serverId, matchId: ctx.matchId });

    await ctx.say('[live] Passage en phase LIVE.');
    await ctx.orch.push(ctx.matchId, 'match:state', await ctx.state.getSnapshot(ctx.matchId));
    ctx.orch.setPhase(ctx.matchId, "live_main")
  }
```

- [ ] **Step 2: Mettre à jour `live.rule.spec.ts`**

Dans `makeCtx()`, remplacer le mock `orch` :
```typescript
    orch: {
      rcon: jest.fn().mockResolvedValue(undefined),
      restartGame: jest.fn().mockResolvedValue(undefined),
      push: jest.fn().mockResolvedValue(undefined),
      roundEnd: jest.fn().mockResolvedValue(undefined),
      setPhase: jest.fn().mockResolvedValue(undefined),
    },
```
par :
```typescript
    orch: {
      startLive: jest.fn().mockResolvedValue(undefined),
      push: jest.fn().mockResolvedValue(undefined),
      roundEnd: jest.fn().mockResolvedValue(undefined),
      setPhase: jest.fn().mockResolvedValue(undefined),
    },
```

Dans le describe `'LiveRule.onEnter'`, remplacer le test :
```typescript
  it('envoie la config competitive et programme le restart à 3s', async () => {
    const rule = new LiveRule(makePauseCmd());
    const ctx = makeCtx();

    await rule.onEnter(ctx);

    expect(ctx.orch.rcon).toHaveBeenCalledWith(
      expect.objectContaining({ serverId: SERVER_ID }),
    );
    expect(ctx.orch.restartGame).toHaveBeenCalledWith(
      expect.objectContaining({ delay: 3 }),
    );
    expect(ctx.orch.setPhase).toHaveBeenCalledWith(MATCH_ID, 'live_main');
  });
```
par :
```typescript
  it('appelle startLive (competitive.cfg + restart, via /live-start)', async () => {
    const rule = new LiveRule(makePauseCmd());
    const ctx = makeCtx();

    await rule.onEnter(ctx);

    expect(ctx.orch.startLive).toHaveBeenCalledWith(
      expect.objectContaining({ serverId: SERVER_ID, matchId: MATCH_ID }),
    );
    expect(ctx.orch.setPhase).toHaveBeenCalledWith(MATCH_ID, 'live_main');
  });
```

- [ ] **Step 3: Lancer les tests ciblés**

Run: `cd backend && npm test -- src/application/match/rules/live.rule.spec.ts`
Expected: PASS

- [ ] **Step 4: Vérifier le typecheck global**

Run: `cd backend && npm run typecheck`
Expected: aucune erreur

- [ ] **Step 5: Commit**

```bash
git add backend/src/application/match/rules/live.rule.ts backend/src/application/match/rules/live.rule.spec.ts
git commit -m "fix(backend): LiveRule applique ggbot/competitive.cfg via /live-start au lieu des fichiers natifs CS2"
```

---

### Task 9: Backend — `MatchVoteService` (vote par équipe, partagé entre !restart et !stop/!continue)

**Files:**
- Create: `backend/src/application/match/commands/match-vote.service.ts`
- Create: `backend/src/application/match/commands/match-vote.service.spec.ts`
- Modify: `backend/src/application/match/state/redis.keys.ts`

**Interfaces:**
- Consumes: `REDIS_CMD` (token d'injection, `@adapters/redis/redis.tokens`), `redisConst`
- Produces: `MatchVoteService.voteRestartKnife(matchId, team)`, `.clearRestartKnifeVote(matchId)`,
  `.voteStop(matchId, team)`, `.clearStopVote(matchId)` — toutes retournent/consomment
  `{ home: boolean; away: boolean }` — consommées par `RestartKnifeCommand` (Task 10) et
  `StopMatchCommand` (Task 11)

- [ ] **Step 1: Ajouter les 2 clés Redis**

Dans `backend/src/application/match/state/redis.keys.ts`, ajouter à la fin de l'objet `redisConst`
(juste avant le `} as const;` final), après la section "Série" :
```typescript
  // Votes par équipe (commandes chat)
  restartKnifeVote:    (m: string) => `match:${m}:restart_knife_vote`, // hash { home, away }
  stopMatchVote:       (m: string) => `match:${m}:stop_vote`,          // hash { home, away }
```

- [ ] **Step 2: Écrire le test (avant l'implémentation)**

Créer `backend/src/application/match/commands/match-vote.service.spec.ts` :
```typescript
import { MatchVoteService } from './match-vote.service';

const MATCH_ID = 'm-test';

function makeRedis() {
  const store = new Map<string, Record<string, string>>();
  return {
    hset: jest.fn(async (key: string, field: string, value: string) => {
      const h = store.get(key) ?? {};
      h[field] = value;
      store.set(key, h);
      return 1;
    }),
    hgetall: jest.fn(async (key: string) => store.get(key) ?? {}),
    del: jest.fn(async (key: string) => {
      store.delete(key);
      return 1;
    }),
  };
}

describe('MatchVoteService — voteRestartKnife', () => {
  it('retourne home=false,away=false tant que personne n\'a voté', async () => {
    const redis = makeRedis();
    const svc = new MatchVoteService(redis as any);
    // aucun vote — vérifié via un vote 'home' isolé, 'away' doit rester false
    const votes = await svc.voteRestartKnife(MATCH_ID, 'home');
    expect(votes).toEqual({ home: true, away: false });
  });

  it('retourne home=true,away=true une fois les deux équipes votées', async () => {
    const redis = makeRedis();
    const svc = new MatchVoteService(redis as any);
    await svc.voteRestartKnife(MATCH_ID, 'home');
    const votes = await svc.voteRestartKnife(MATCH_ID, 'away');
    expect(votes).toEqual({ home: true, away: true });
  });

  it('clearRestartKnifeVote() supprime la clé', async () => {
    const redis = makeRedis();
    const svc = new MatchVoteService(redis as any);
    await svc.voteRestartKnife(MATCH_ID, 'home');
    await svc.clearRestartKnifeVote(MATCH_ID);
    const votes = await svc.voteRestartKnife(MATCH_ID, 'away');
    expect(votes).toEqual({ home: false, away: true });
  });
});

describe('MatchVoteService — voteStop', () => {
  it('fonctionne indépendamment de voteRestartKnife (clé Redis distincte)', async () => {
    const redis = makeRedis();
    const svc = new MatchVoteService(redis as any);
    await svc.voteRestartKnife(MATCH_ID, 'home');
    const stopVotes = await svc.voteStop(MATCH_ID, 'away');
    expect(stopVotes).toEqual({ home: false, away: true });
  });

  it('clearStopVote() supprime la clé', async () => {
    const redis = makeRedis();
    const svc = new MatchVoteService(redis as any);
    await svc.voteStop(MATCH_ID, 'home');
    await svc.clearStopVote(MATCH_ID);
    const votes = await svc.voteStop(MATCH_ID, 'away');
    expect(votes).toEqual({ home: false, away: true });
  });
});
```

- [ ] **Step 3: Lancer le test et vérifier qu'il échoue (le fichier source n'existe pas encore)**

Run: `cd backend && npm test -- src/application/match/commands/match-vote.service.spec.ts`
Expected: FAIL avec `Cannot find module './match-vote.service'`

- [ ] **Step 4: Créer `match-vote.service.ts`**

```typescript
// src/application/match/commands/match-vote.service.ts
import { Injectable, Inject } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS_CMD } from '@adapters/redis/redis.tokens';
import { redisConst } from '@app/match/state/redis.keys';
import type { Logical } from '@app/match/state';

export type TeamVotes = { home: boolean; away: boolean };

@Injectable()
export class MatchVoteService {
  constructor(@Inject(REDIS_CMD) private readonly redis: Redis) {}

  private async voteAndRead(key: string, team: Logical): Promise<TeamVotes> {
    await this.redis.hset(key, team, '1');
    const v = await this.redis.hgetall(key);
    return { home: v.home === '1', away: v.away === '1' };
  }

  async voteRestartKnife(matchId: string, team: Logical): Promise<TeamVotes> {
    return this.voteAndRead(redisConst.restartKnifeVote(matchId), team);
  }

  async clearRestartKnifeVote(matchId: string): Promise<void> {
    await this.redis.del(redisConst.restartKnifeVote(matchId));
  }

  async voteStop(matchId: string, team: Logical): Promise<TeamVotes> {
    return this.voteAndRead(redisConst.stopMatchVote(matchId), team);
  }

  async clearStopVote(matchId: string): Promise<void> {
    await this.redis.del(redisConst.stopMatchVote(matchId));
  }
}
```

- [ ] **Step 5: Relancer le test et vérifier qu'il passe**

Run: `cd backend && npm test -- src/application/match/commands/match-vote.service.spec.ts`
Expected: PASS (5 tests verts)

- [ ] **Step 6: Vérifier le typecheck**

Run: `cd backend && npm run typecheck`
Expected: aucune erreur

- [ ] **Step 7: Commit**

```bash
git add backend/src/application/match/commands/match-vote.service.ts backend/src/application/match/commands/match-vote.service.spec.ts backend/src/application/match/state/redis.keys.ts
git commit -m "feat(backend): ajoute MatchVoteService pour le vote par equipe (restart knife, stop/continue)"
```

---

### Task 10: Backend — `!restart` (revote du knife round)

**Files:**
- Create: `backend/src/application/match/commands/restart-knife.command.ts`
- Create: `backend/src/application/match/commands/restart-knife.command.spec.ts`
- Modify: `backend/src/application/match/rules/knife.rule.ts` (constructeur + wiring)
- Modify: `backend/src/application/match/rules/knife.rule.spec.ts` (nouveau param constructeur)
- Modify: `backend/src/application/match/rules/knife-choice.rule.ts` (constructeur + wiring)
- Modify: `backend/src/application/match/rules/rule.registry.ts`
- Modify: `backend/src/application/match/rules/rules.module.ts`

**Interfaces:**
- Consumes: `MatchVoteService.voteRestartKnife/clearRestartKnifeVote` (Task 9),
  `ctx.orch.sideToLogical`, `ctx.orch.startPhaseCountdown`, `ctx.state.getServerIdFromMatchId`
  (déjà exposées par `RuleContext`, aucune modification de `rule-context.ts` nécessaire)
- Produces: `RestartKnifeCommand` (classe injectable), commande chat `!restart` active en
  `KNIFE_LIVE` et `KNIFE_CHOICE`

- [ ] **Step 1: Écrire le test (avant l'implémentation)**

Créer `backend/src/application/match/commands/restart-knife.command.spec.ts` :
```typescript
import { RestartKnifeCommand } from './restart-knife.command';
import { MatchPhase } from '@domain/phase.types';

const MATCH_ID = 'm-test';
const SERVER_ID = 'srv-a';

function makeEvent(command = 'restart', team: 'CT' | 'T' | 'SPECTATOR' = 'CT') {
  return {
    type: 'command',
    matchId: MATCH_ID,
    serverId: SERVER_ID,
    round: 1,
    tick: 0,
    payload: { command, parameters: [], sender: { name: 'Garitos', steamId: 'STEAM_1', team } },
  } as any;
}

function makeVotes(overrides?: { voteRestartKnife?: { home: boolean; away: boolean } }) {
  return {
    voteRestartKnife: jest.fn().mockResolvedValue(overrides?.voteRestartKnife ?? { home: true, away: false }),
    clearRestartKnifeVote: jest.fn().mockResolvedValue(undefined),
  };
}

function makeCtx() {
  return {
    matchId: MATCH_ID,
    serverId: SERVER_ID,
    say: jest.fn().mockResolvedValue(undefined),
    pubEvent: jest.fn().mockResolvedValue(undefined),
    orch: {
      sideToLogical: jest.fn().mockImplementation((_m: string, side: string) =>
        Promise.resolve(side === 'CT' ? 'home' : side === 'T' ? 'away' : null),
      ),
      startPhaseCountdown: jest.fn().mockResolvedValue(undefined),
    },
    state: {
      getServerIdFromMatchId: jest.fn().mockResolvedValue(SERVER_ID),
    },
  } as any;
}

describe('RestartKnifeCommand.canHandle', () => {
  it('refuse si sender=SPECTATOR', async () => {
    const cmd = new RestartKnifeCommand(makeVotes() as any);
    const ctx = makeCtx();
    const result = await cmd.canHandle(makeEvent('restart', 'SPECTATOR'), ctx);
    expect(result).toBe(false);
  });

  it('accepte si sender=CT ou T', async () => {
    const cmd = new RestartKnifeCommand(makeVotes() as any);
    const ctx = makeCtx();
    expect(await cmd.canHandle(makeEvent('restart', 'CT'), ctx)).toBe(true);
    expect(await cmd.canHandle(makeEvent('restart', 'T'), ctx)).toBe(true);
  });
});

describe('RestartKnifeCommand.handle', () => {
  it('enregistre le vote et ne relance rien si une seule équipe a voté', async () => {
    const votes = makeVotes({ voteRestartKnife: { home: true, away: false } });
    const cmd = new RestartKnifeCommand(votes as any);
    const ctx = makeCtx();

    const result = await cmd.handle(makeEvent('restart', 'CT'), ctx);

    expect(result).toBe(true);
    expect(votes.voteRestartKnife).toHaveBeenCalledWith(MATCH_ID, 'home');
    expect(votes.clearRestartKnifeVote).not.toHaveBeenCalled();
    expect(ctx.orch.startPhaseCountdown).not.toHaveBeenCalled();
  });

  it('relance le knife round (countdown KNIFE_LIVE) quand les deux équipes ont voté', async () => {
    const votes = makeVotes({ voteRestartKnife: { home: true, away: true } });
    const cmd = new RestartKnifeCommand(votes as any);
    const ctx = makeCtx();

    const result = await cmd.handle(makeEvent('restart', 'T'), ctx);

    expect(result).toBe(true);
    expect(votes.clearRestartKnifeVote).toHaveBeenCalledWith(MATCH_ID);
    expect(ctx.orch.startPhaseCountdown).toHaveBeenCalledWith(
      MATCH_ID,
      MatchPhase.KNIFE_LIVE,
      3,
      SERVER_ID,
    );
  });
});
```

- [ ] **Step 2: Lancer le test et vérifier qu'il échoue**

Run: `cd backend && npm test -- src/application/match/commands/restart-knife.command.spec.ts`
Expected: FAIL avec `Cannot find module './restart-knife.command'`

- [ ] **Step 3: Créer `restart-knife.command.ts`**

```typescript
// src/application/match/commands/restart-knife.command.ts
import { Injectable } from '@nestjs/common';
import { BaseCommand } from '@domain/commands/base.command';
import { CommandEvent } from '@domain/events/command.event';
import { RuleContext } from '@domain/rules';
import { MatchPhase } from '@domain/phase.types';
import { MatchVoteService } from './match-vote.service';

@Injectable()
export class RestartKnifeCommand extends BaseCommand {
  constructor(private readonly votes: MatchVoteService) {
    super();
  }

  async canHandle(event: CommandEvent, ctx: RuleContext): Promise<boolean> {
    if (event.payload.command !== 'restart') return false;
    const senderTeam = event.payload.sender.team;
    if (senderTeam !== 'CT' && senderTeam !== 'T') {
      await ctx.say('Seuls les joueurs des deux équipes peuvent relancer le knife round.');
      return false;
    }
    return true;
  }

  async handle(event: CommandEvent, ctx: RuleContext): Promise<boolean> {
    this.logCommand('!restart', event);

    const team = await ctx.orch.sideToLogical(event.matchId, event.payload.sender.team);
    if (!team) return false;

    await ctx.say(`[knife] ${event.payload.sender.name} (${team}) veut relancer le knife round.`);
    const votes = await this.votes.voteRestartKnife(event.matchId, team);

    if (votes.home && votes.away) {
      await this.votes.clearRestartKnifeVote(event.matchId);
      await ctx.say("[knife] Les deux équipes sont d'accord — relance du knife round.");
      const serverId = event.serverId ?? (await ctx.state.getServerIdFromMatchId(event.matchId));
      if (serverId) {
        await ctx.orch.startPhaseCountdown(event.matchId, MatchPhase.KNIFE_LIVE, 3, serverId);
      }
    }
    return true;
  }
}
```

- [ ] **Step 4: Relancer le test et vérifier qu'il passe**

Run: `cd backend && npm test -- src/application/match/commands/restart-knife.command.spec.ts`
Expected: PASS (4 tests verts)

- [ ] **Step 5: Câbler `RestartKnifeCommand` dans `KnifeRule`**

Dans `backend/src/application/match/rules/knife.rule.ts`, remplacer :
```typescript
export class KnifeRule extends BaseRule implements PhaseRule {
  name = 'knife_live' as const;

  publicTypes = new Set<EventType>([
    EventTypes.KILL,
    EventTypes.TEAM_ROUND_WIN,
    'match:state' as EventType,
    'pause:update' as EventType,
  ]);

  private state = new Map<string, KnifeState>();

  constructor() {
    super();
    this.events.set(EventTypes.KILL, this.onKill.bind(this));
    this.events.set(EventTypes.TEAM_ROUND_WIN, this.onTeamRoundWin.bind(this));
  }
```
par :
```typescript
export class KnifeRule extends BaseRule implements PhaseRule {
  name = 'knife_live' as const;

  publicTypes = new Set<EventType>([
    EventTypes.KILL,
    EventTypes.TEAM_ROUND_WIN,
    'match:state' as EventType,
    'pause:update' as EventType,
  ]);

  private state = new Map<string, KnifeState>();

  constructor(private readonly restartCmd: RestartKnifeCommand) {
    super();
    this.events.set(EventTypes.KILL, this.onKill.bind(this));
    this.events.set(EventTypes.TEAM_ROUND_WIN, this.onTeamRoundWin.bind(this));
    this.commands.set('restart', this.onRestartCommand.bind(this));
  }

  private async onRestartCommand(cmd: CommandEvent, ctx: RuleContext) {
    await this.restartCmd.handle(cmd, ctx);
  }
```
Ajouter l'import en tête de fichier :
```typescript
import type { CommandEvent } from '@domain/events/command.event';
import { RestartKnifeCommand } from '@app/match/commands/restart-knife.command';
```
> Note : `TC-04 — Commande inconnue ignorée` dans `knife.rule.spec.ts` teste actuellement
> `expect((rule as any).commands.size).toBe(0)` — ce test doit être mis à jour au Step 7 puisque
> `commands.size` vaut désormais 1.

- [ ] **Step 6: Câbler `RestartKnifeCommand` dans `KnifeChoiceRule`**

Dans `backend/src/application/match/rules/knife-choice.rule.ts`, remplacer :
```typescript
  constructor(
    private readonly knifeChoiceCmd: KnifeChoiceCommand // Injection de la commande
  ) {
    super();
    this.commands.set('stay', this.onCommand.bind(this));
    this.commands.set('switch', this.onCommand.bind(this));
    this.commands.set('swap', this.onCommand.bind(this));
  }
```
par :
```typescript
  constructor(
    private readonly knifeChoiceCmd: KnifeChoiceCommand,
    private readonly restartCmd: RestartKnifeCommand,
  ) {
    super();
    this.commands.set('stay', this.onCommand.bind(this));
    this.commands.set('switch', this.onCommand.bind(this));
    this.commands.set('swap', this.onCommand.bind(this));
    this.commands.set('restart', this.onRestartCommand.bind(this));
  }

  private async onRestartCommand(cmd: CommandEvent, ctx: RuleContext) {
    await this.restartCmd.handle(cmd, ctx);
  }
```
Ajouter l'import en tête de fichier :
```typescript
import { RestartKnifeCommand } from '@app/match/commands/restart-knife.command';
```

- [ ] **Step 7: Mettre à jour `knife.rule.spec.ts` pour le nouveau paramètre constructeur**

Remplacer chaque `new KnifeRule()` par `new KnifeRule(makeRestartCmd())`, et ajouter en haut du fichier
(après les imports existants) :
```typescript
function makeRestartCmd() {
  return { handle: jest.fn().mockResolvedValue(true) } as any;
}
```
Remplacer le test `TC-04` :
```typescript
describe('TC-04 — Commande inconnue ignorée', () => {
  it("KnifeRule n'écoute pas les commandes inconnues", () => {
    const rule = new KnifeRule();
    // La rule knife ne register aucune commande
    expect((rule as any).commands.size).toBe(0);
  });
});
```
par :
```typescript
describe('TC-04 — Commande inconnue ignorée', () => {
  it("KnifeRule n'écoute que !restart", () => {
    const rule = new KnifeRule(makeRestartCmd());
    expect((rule as any).commands.size).toBe(1);
    expect((rule as any).commands.has('restart')).toBe(true);
  });
});
```

- [ ] **Step 8: Câbler dans `RuleRegistry`**

Dans `backend/src/application/match/rules/rule.registry.ts`, remplacer :
```typescript
import { KnifeChoiceCommand } from "../commands/knife-choice.command";
import { PauseCommand } from "../commands/pause.command";

@Injectable()
export class RuleRegistry {
  private readonly rules = new Map<MatchPhase, PhaseRule>();

  constructor(
    private readonly readyCmd: ReadyCommand,
    private readonly knifeCmd: KnifeChoiceCommand,
    private readonly pauseCmd: PauseCommand,
  ) {
    const warmupRule = new WarmupRule(this.readyCmd);
    const knifeRule = new KnifeRule(/* passez ici ses dépendances si besoin */);
    const knifeChoiceRule = new KnifeChoiceRule(this.knifeCmd);
    const liveRule = new LiveRule(this.pauseCmd);
```
par :
```typescript
import { KnifeChoiceCommand } from "../commands/knife-choice.command";
import { PauseCommand } from "../commands/pause.command";
import { RestartKnifeCommand } from "../commands/restart-knife.command";

@Injectable()
export class RuleRegistry {
  private readonly rules = new Map<MatchPhase, PhaseRule>();

  constructor(
    private readonly readyCmd: ReadyCommand,
    private readonly knifeCmd: KnifeChoiceCommand,
    private readonly pauseCmd: PauseCommand,
    private readonly restartCmd: RestartKnifeCommand,
  ) {
    const warmupRule = new WarmupRule(this.readyCmd);
    const knifeRule = new KnifeRule(this.restartCmd);
    const knifeChoiceRule = new KnifeChoiceRule(this.knifeCmd, this.restartCmd);
    const liveRule = new LiveRule(this.pauseCmd);
```

- [ ] **Step 9: Déclarer `RestartKnifeCommand` et `MatchVoteService` comme providers**

Dans `backend/src/application/match/rules/rules.module.ts`, remplacer :
```typescript
import { ReadyCommand } from '@app/match/commands/ready.command';
import { PauseCommand } from '../commands/pause.command';
import { KnifeChoiceCommand } from '../commands/knife-choice.command';

@Module({
  imports: [
    RedisModule,
    MatchStateModule,
    forwardRef(() => CommandsModule),
    forwardRef(() => MatchOrchestratorModule),
  ],
  providers: [
    RuleRegistry,
    RuleContextFactory,
    ReadyCommand,
    PauseCommand,
    KnifeChoiceCommand,
  ],
```
par :
```typescript
import { ReadyCommand } from '@app/match/commands/ready.command';
import { PauseCommand } from '../commands/pause.command';
import { KnifeChoiceCommand } from '../commands/knife-choice.command';
import { RestartKnifeCommand } from '../commands/restart-knife.command';
import { MatchVoteService } from '../commands/match-vote.service';

@Module({
  imports: [
    RedisModule,
    MatchStateModule,
    forwardRef(() => CommandsModule),
    forwardRef(() => MatchOrchestratorModule),
  ],
  providers: [
    RuleRegistry,
    RuleContextFactory,
    ReadyCommand,
    PauseCommand,
    KnifeChoiceCommand,
    RestartKnifeCommand,
    MatchVoteService,
  ],
```

- [ ] **Step 10: Lancer tous les tests concernés + typecheck**

Run:
```bash
cd backend
npm test -- src/application/match/rules/knife.rule.spec.ts
npm test -- src/application/match/commands/restart-knife.command.spec.ts
npm run typecheck
```
Expected: tous PASS, typecheck sans erreur

- [ ] **Step 11: Commit**

```bash
git add backend/src/application/match/commands/restart-knife.command.ts \
        backend/src/application/match/commands/restart-knife.command.spec.ts \
        backend/src/application/match/rules/knife.rule.ts \
        backend/src/application/match/rules/knife.rule.spec.ts \
        backend/src/application/match/rules/knife-choice.rule.ts \
        backend/src/application/match/rules/rule.registry.ts \
        backend/src/application/match/rules/rules.module.ts
git commit -m "feat(backend): ajoute la commande chat !restart (revote du knife round)"
```

---

### Task 11: Backend — `!stop` / `!continue` (arrêt/reprise votés)

**Files:**
- Modify: `backend/src/application/match/pause/pause.service.ts` (ajout `'stopped'` à `PauseReason`)
- Create: `backend/src/application/match/commands/stop-match.command.ts`
- Create: `backend/src/application/match/commands/stop-match.command.spec.ts`
- Modify: `backend/src/application/match/rules/live.rule.ts` (constructeur + wiring)
- Modify: `backend/src/application/match/rules/rule.registry.ts`
- Modify: `backend/src/application/match/rules/rules.module.ts`

**Interfaces:**
- Consumes: `PauseMatchService.getPauseState/pause/resume` (existant), `MatchCommandsService.pause/unpause`
  (existant), `MatchVoteService.voteStop/clearStopVote` (Task 9)
- Produces: `StopMatchCommand` (classe injectable), commandes chat `!stop`/`!continue` actives en `LIVE_MAIN`
  (l'overtime n'est pas mappée dans `RuleRegistry` aujourd'hui — hors périmètre, voir spec)

- [ ] **Step 1: Ajouter `'stopped'` à `PauseReason`**

Dans `backend/src/application/match/pause/pause.service.ts`, remplacer :
```typescript
export type PauseReason = 'tactical' | 'technical' | 'admin';
```
par :
```typescript
export type PauseReason = 'tactical' | 'technical' | 'admin' | 'stopped';
```
> Aucune autre modification nécessaire dans ce fichier : la branche `else` de `pause()` (pas de
> messages périodiques pour les raisons non tactical/technical) et le calcul d'`id` à `null` dans
> `resume()` couvrent déjà `'stopped'` correctement par construction.

- [ ] **Step 2: Écrire le test (avant l'implémentation)**

Créer `backend/src/application/match/commands/stop-match.command.spec.ts` :
```typescript
import { StopMatchCommand } from './stop-match.command';

const MATCH_ID = 'm-test';
const SERVER_ID = 'srv-a';

function makeEvent(command: 'stop' | 'continue', team: 'CT' | 'T' | 'SPECTATOR' = 'CT') {
  return {
    type: 'command',
    matchId: MATCH_ID,
    serverId: SERVER_ID,
    round: 5,
    tick: 0,
    payload: { command, parameters: [], sender: { name: 'Garitos', steamId: 'STEAM_1', team } },
  } as any;
}

function makePauseService(overrides?: { reason?: string }) {
  return {
    getPauseState: jest.fn().mockResolvedValue({ state: overrides?.reason ? 'paused' : 'none', reason: overrides?.reason }),
    pause: jest.fn().mockResolvedValue(undefined),
    resume: jest.fn().mockResolvedValue(undefined),
  };
}

function makeRconService() {
  return { pause: jest.fn().mockResolvedValue(undefined), unpause: jest.fn().mockResolvedValue(undefined) };
}

function makeVotes(votes: { home: boolean; away: boolean }) {
  return {
    voteStop: jest.fn().mockResolvedValue(votes),
    clearStopVote: jest.fn().mockResolvedValue(undefined),
  };
}

function makeCtx() {
  return {
    matchId: MATCH_ID,
    serverId: SERVER_ID,
    say: jest.fn().mockResolvedValue(undefined),
    pubEvent: jest.fn().mockResolvedValue(undefined),
    orch: {
      sideToLogical: jest.fn().mockImplementation((_m: string, side: string) =>
        Promise.resolve(side === 'CT' ? 'home' : side === 'T' ? 'away' : null),
      ),
    },
    state: { getServerIdFromMatchId: jest.fn().mockResolvedValue(SERVER_ID) },
  } as any;
}

describe('StopMatchCommand.canHandle', () => {
  it('refuse !stop si déjà arrêté', async () => {
    const cmd = new StopMatchCommand(makePauseService({ reason: 'stopped' }) as any, makeRconService() as any, makeVotes({ home: false, away: false }) as any);
    const ctx = makeCtx();
    expect(await cmd.canHandle(makeEvent('stop'), ctx)).toBe(false);
  });

  it('refuse !continue si pas arrêté', async () => {
    const cmd = new StopMatchCommand(makePauseService() as any, makeRconService() as any, makeVotes({ home: false, away: false }) as any);
    const ctx = makeCtx();
    expect(await cmd.canHandle(makeEvent('continue'), ctx)).toBe(false);
  });

  it('refuse si sender=SPECTATOR', async () => {
    const cmd = new StopMatchCommand(makePauseService() as any, makeRconService() as any, makeVotes({ home: false, away: false }) as any);
    const ctx = makeCtx();
    expect(await cmd.canHandle(makeEvent('stop', 'SPECTATOR'), ctx)).toBe(false);
  });
});

describe('StopMatchCommand.handle — !stop', () => {
  it('enregistre le vote sans arrêter si une seule équipe a voté', async () => {
    const pauseService = makePauseService();
    const rconService = makeRconService();
    const votes = makeVotes({ home: true, away: false });
    const cmd = new StopMatchCommand(pauseService as any, rconService as any, votes as any);
    const ctx = makeCtx();

    await cmd.handle(makeEvent('stop', 'CT'), ctx);

    expect(votes.voteStop).toHaveBeenCalledWith(MATCH_ID, 'home');
    expect(pauseService.pause).not.toHaveBeenCalled();
    expect(rconService.pause).not.toHaveBeenCalled();
  });

  it('arrête le match (reason=stopped) quand les deux équipes ont voté', async () => {
    const pauseService = makePauseService();
    const rconService = makeRconService();
    const votes = makeVotes({ home: true, away: true });
    const cmd = new StopMatchCommand(pauseService as any, rconService as any, votes as any);
    const ctx = makeCtx();

    await cmd.handle(makeEvent('stop', 'T'), ctx);

    expect(votes.clearStopVote).toHaveBeenCalledWith(MATCH_ID);
    expect(pauseService.pause).toHaveBeenCalledWith(
      MATCH_ID,
      SERVER_ID,
      expect.objectContaining({ reason: 'stopped', armOnly: false }),
    );
    expect(rconService.pause).toHaveBeenCalledWith(
      expect.objectContaining({ serverId: SERVER_ID, matchId: MATCH_ID }),
    );
  });
});

describe('StopMatchCommand.handle — !continue', () => {
  it('reprend le match quand les deux équipes ont voté continue', async () => {
    const pauseService = makePauseService({ reason: 'stopped' });
    const rconService = makeRconService();
    const votes = makeVotes({ home: true, away: true });
    const cmd = new StopMatchCommand(pauseService as any, rconService as any, votes as any);
    const ctx = makeCtx();

    await cmd.handle(makeEvent('continue', 'CT'), ctx);

    expect(votes.clearStopVote).toHaveBeenCalledWith(MATCH_ID);
    expect(pauseService.resume).toHaveBeenCalledWith(MATCH_ID);
    expect(rconService.unpause).toHaveBeenCalledWith(
      expect.objectContaining({ serverId: SERVER_ID, matchId: MATCH_ID }),
    );
  });
});
```

- [ ] **Step 3: Lancer le test et vérifier qu'il échoue**

Run: `cd backend && npm test -- src/application/match/commands/stop-match.command.spec.ts`
Expected: FAIL avec `Cannot find module './stop-match.command'`

- [ ] **Step 4: Créer `stop-match.command.ts`**

```typescript
// src/application/match/commands/stop-match.command.ts
import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { BaseCommand } from '@domain/commands/base.command';
import { CommandEvent } from '@domain/events/command.event';
import { RuleContext } from '@domain/rules';
import { PauseMatchService } from '@app/match/pause/pause.service';
import { MatchCommandsService } from '@app/commands/match-commands.service';
import { MatchVoteService } from './match-vote.service';

@Injectable()
export class StopMatchCommand extends BaseCommand {
  constructor(
    private readonly pauseService: PauseMatchService,
    @Inject(forwardRef(() => MatchCommandsService))
    private readonly rconService: MatchCommandsService,
    private readonly votes: MatchVoteService,
  ) {
    super();
  }

  async canHandle(event: CommandEvent, ctx: RuleContext): Promise<boolean> {
    const isStop = event.payload.command === 'stop';
    const isContinue = event.payload.command === 'continue';
    if (!isStop && !isContinue) return false;

    const senderTeam = event.payload.sender.team;
    if (senderTeam !== 'CT' && senderTeam !== 'T') {
      await ctx.say('Seuls les joueurs des deux équipes peuvent voter.');
      return false;
    }

    const state = await this.pauseService.getPauseState(event.matchId);
    const isStopped = state.reason === 'stopped';
    if (isStop && isStopped) {
      await ctx.say('Le match est déjà arrêté.');
      return false;
    }
    if (isContinue && !isStopped) {
      await ctx.say("Le match n'est pas arrêté.");
      return false;
    }
    return true;
  }

  async handle(event: CommandEvent, ctx: RuleContext): Promise<boolean> {
    const isStop = event.payload.command === 'stop';
    this.logCommand(isStop ? '!stop' : '!continue', event);

    const team = await ctx.orch.sideToLogical(event.matchId, event.payload.sender.team);
    if (!team) return false;

    const serverId = event.serverId ?? (await ctx.state.getServerIdFromMatchId(event.matchId));
    if (!serverId) return false;

    if (isStop) {
      await ctx.say(`[match] ${event.payload.sender.name} veut arrêter le match.`);
      const votes = await this.votes.voteStop(event.matchId, team);
      if (votes.home && votes.away) {
        await this.votes.clearStopVote(event.matchId);
        await this.pauseService.pause(event.matchId, serverId, {
          reason: 'stopped',
          team: 'system',
          armOnly: false,
        });
        await this.rconService.pause({ serverId, matchId: event.matchId });
        await ctx.say('[match] Les deux équipes ont voté — match arrêté.');
      }
      return true;
    }

    await ctx.say(`[match] ${event.payload.sender.name} veut reprendre le match.`);
    const votes = await this.votes.voteStop(event.matchId, team);
    if (votes.home && votes.away) {
      await this.votes.clearStopVote(event.matchId);
      await this.pauseService.resume(event.matchId);
      await this.rconService.unpause({ serverId, matchId: event.matchId });
      await ctx.say('[match] Les deux équipes ont voté — match repris.');
    }
    return true;
  }
}
```

- [ ] **Step 5: Relancer le test et vérifier qu'il passe**

Run: `cd backend && npm test -- src/application/match/commands/stop-match.command.spec.ts`
Expected: PASS (7 tests verts)

- [ ] **Step 6: Câbler `StopMatchCommand` dans `LiveRule`**

Dans `backend/src/application/match/rules/live.rule.ts`, remplacer :
```typescript
  constructor(
    private readonly pauseCmd: PauseCommand
  ) {
    super();
    this.events.set(EventTypes.ROUND_START, this.onRoundStart.bind(this));
    this.events.set(EventTypes.TEAM_ROUND_WIN, this.onTeamRoundWin.bind(this));
    this.events.set(EventTypes.KILL, this.onKill.bind(this));

    // Délégation des commandes à la nouvelle classe
    this.commands.set('pause', this.onCommand.bind(this));
    this.commands.set('unpause', this.onCommand.bind(this));
    this.commands.set('tac', this.onCommand.bind(this));
    this.commands.set('tech', this.onCommand.bind(this));
  }
```
par :
```typescript
  constructor(
    private readonly pauseCmd: PauseCommand,
    private readonly stopCmd: StopMatchCommand,
  ) {
    super();
    this.events.set(EventTypes.ROUND_START, this.onRoundStart.bind(this));
    this.events.set(EventTypes.TEAM_ROUND_WIN, this.onTeamRoundWin.bind(this));
    this.events.set(EventTypes.KILL, this.onKill.bind(this));

    // Délégation des commandes à la nouvelle classe
    this.commands.set('pause', this.onCommand.bind(this));
    this.commands.set('unpause', this.onCommand.bind(this));
    this.commands.set('tac', this.onCommand.bind(this));
    this.commands.set('tech', this.onCommand.bind(this));
    this.commands.set('stop', this.onStopCommand.bind(this));
    this.commands.set('continue', this.onStopCommand.bind(this));
  }

  private async onStopCommand(cmd: CommandEvent, ctx: RuleContext) {
    await this.stopCmd.handle(cmd, ctx);
  }
```
Ajouter l'import en tête de fichier :
```typescript
import { StopMatchCommand } from '@app/match/commands/stop-match.command';
```

- [ ] **Step 7: Câbler dans `RuleRegistry`**

Dans `backend/src/application/match/rules/rule.registry.ts`, remplacer :
```typescript
import { RestartKnifeCommand } from "../commands/restart-knife.command";

@Injectable()
export class RuleRegistry {
  private readonly rules = new Map<MatchPhase, PhaseRule>();

  constructor(
    private readonly readyCmd: ReadyCommand,
    private readonly knifeCmd: KnifeChoiceCommand,
    private readonly pauseCmd: PauseCommand,
    private readonly restartCmd: RestartKnifeCommand,
  ) {
    const warmupRule = new WarmupRule(this.readyCmd);
    const knifeRule = new KnifeRule(this.restartCmd);
    const knifeChoiceRule = new KnifeChoiceRule(this.knifeCmd, this.restartCmd);
    const liveRule = new LiveRule(this.pauseCmd);
```
par :
```typescript
import { RestartKnifeCommand } from "../commands/restart-knife.command";
import { StopMatchCommand } from "../commands/stop-match.command";

@Injectable()
export class RuleRegistry {
  private readonly rules = new Map<MatchPhase, PhaseRule>();

  constructor(
    private readonly readyCmd: ReadyCommand,
    private readonly knifeCmd: KnifeChoiceCommand,
    private readonly pauseCmd: PauseCommand,
    private readonly restartCmd: RestartKnifeCommand,
    private readonly stopCmd: StopMatchCommand,
  ) {
    const warmupRule = new WarmupRule(this.readyCmd);
    const knifeRule = new KnifeRule(this.restartCmd);
    const knifeChoiceRule = new KnifeChoiceRule(this.knifeCmd, this.restartCmd);
    const liveRule = new LiveRule(this.pauseCmd, this.stopCmd);
```

- [ ] **Step 8: Déclarer `StopMatchCommand` comme provider**

Dans `backend/src/application/match/rules/rules.module.ts`, remplacer :
```typescript
import { RestartKnifeCommand } from '../commands/restart-knife.command';
import { MatchVoteService } from '../commands/match-vote.service';

@Module({
  imports: [
    RedisModule,
    MatchStateModule,
    forwardRef(() => CommandsModule),
    forwardRef(() => MatchOrchestratorModule),
  ],
  providers: [
    RuleRegistry,
    RuleContextFactory,
    ReadyCommand,
    PauseCommand,
    KnifeChoiceCommand,
    RestartKnifeCommand,
    MatchVoteService,
  ],
```
par :
```typescript
import { RestartKnifeCommand } from '../commands/restart-knife.command';
import { StopMatchCommand } from '../commands/stop-match.command';
import { MatchVoteService } from '../commands/match-vote.service';

@Module({
  imports: [
    RedisModule,
    MatchStateModule,
    forwardRef(() => CommandsModule),
    forwardRef(() => MatchOrchestratorModule),
  ],
  providers: [
    RuleRegistry,
    RuleContextFactory,
    ReadyCommand,
    PauseCommand,
    KnifeChoiceCommand,
    RestartKnifeCommand,
    StopMatchCommand,
    MatchVoteService,
  ],
```

- [ ] **Step 9: Lancer tous les tests concernés + typecheck**

Run:
```bash
cd backend
npm test -- src/application/match/commands/stop-match.command.spec.ts
npm test -- src/application/match/rules/live.rule.spec.ts
npm run typecheck
```
Expected: tous PASS, typecheck sans erreur

- [ ] **Step 10: Commit**

```bash
git add backend/src/application/match/pause/pause.service.ts \
        backend/src/application/match/commands/stop-match.command.ts \
        backend/src/application/match/commands/stop-match.command.spec.ts \
        backend/src/application/match/rules/live.rule.ts \
        backend/src/application/match/rules/rule.registry.ts \
        backend/src/application/match/rules/rules.module.ts
git commit -m "feat(backend): ajoute les commandes chat !stop/!continue (arret/reprise votes)"
```

---

### Task 12: Vérification globale

**Files:** aucun (vérification uniquement)

**Interfaces:** aucune

- [ ] **Step 1: Suite de tests complète + typecheck + build**

Run: `cd backend && npm run typecheck && npm run build && npm test`
Expected: tout PASS, build réussi

- [ ] **Step 2: Build agent Go**

Run: `cd agent && go build ./cmd/manager && go build ./cmd/agent`
Expected: aucune erreur

- [ ] **Step 3: Script de vérification global**

Run: `./scripts/check.sh --no-smoke` (depuis la racine du repo)
Expected: `✅ Vérifications terminées (sans smoke test)`

- [ ] **Step 4: Smoke test manuel des 3 nouveaux endpoints agent (si un environnement docker compose est disponible)**

```bash
docker compose up -d
docker compose --profile agent up -d
curl -X POST http://localhost:8082/warmup-start -H "X-Agent-Token: <token>"
curl -X POST http://localhost:8082/knife-start -H "X-Agent-Token: <token>"
curl -X POST http://localhost:8082/live-start -H "X-Agent-Token: <token>" \
  -H "Content-Type: application/json" -d '{"matchId":"m-test","delay":3}'
```
Expected: `{"ok":true}` sur chacun, logs agent cohérents (voir Tasks 1-2)

- [ ] **Step 5: Commit final si des ajustements ont été faits pendant la vérification**

```bash
git status
# Si des fichiers ont été modifiés pendant les steps précédents (correctifs typecheck/tests) :
git add -A
git commit -m "chore: ajustements finaux suite a la verification globale"
```

---

## Self-Review (effectuée pendant la rédaction)

**Couverture du spec** :
- API agent nommée (`/warmup-start`, `/knife-start`, `/live-start`) → Tasks 1-2 ✅
- Nettoyage warmup/knife/live (bug fichiers natifs CS2, doubles applications) → Tasks 4-8 ✅
- `!restart` → Task 10 ✅
- `!stop`/`!continue` → Task 11 (avec limite explicite : LIVE_MAIN seulement, OVERTIME hors périmètre,
  documentée dans le spec) ✅
- Code mort supprimé (`stopMatch`, ancien `startLive`, 4 stubs vides) → Task 4 ✅

**Cohérence de types vérifiée** :
- `MatchOrchestrator.startWarmup` change de signature `string` → `{serverId?, matchId?}` : tous les
  appelants (un seul : `knife.rule.ts`) mis à jour dans le même Task (6) qui introduit le changement
  d'orchestrateur (Task 5) — pas de fenêtre où le code ne compile pas entre deux commits.
- `PauseReason` étendu avec `'stopped'` (Task 11) avant que `StopMatchCommand` ne l'utilise (même Task).
- `RuleContext.state` (Pick<> restreint dans `rule-context.ts`) n'est PAS modifié : les nouvelles
  commandes (`RestartKnifeCommand`, `StopMatchCommand`) injectent leurs dépendances directement
  (`MatchVoteService`, `PauseMatchService`, `MatchCommandsService`) au lieu de passer par `ctx.state`,
  suivant le pattern déjà établi par `PauseCommand` (qui fait déjà exactement ça).
- Constructeurs `KnifeRule`/`KnifeChoiceRule`/`LiveRule` : chaque nouveau paramètre est ajouté et câblé
  dans le même Task que la fonctionnalité qui en a besoin, avec mise à jour immédiate de
  `rule.registry.ts` et des tests concernés (aucun test cassé qui ne soit pas corrigé dans le même Task).
