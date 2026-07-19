# Spec — Intégration commandes/config manquantes (inspiré eBot)

> Statut : **Conçu, en attente de validation finale** (voir `docs/ebot-reference.md` pour le contexte
> eBot ayant inspiré ce document). Prochaine étape après validation : `writing-plans` → plan d'implémentation.

## Objectif

Combler deux manques identifiés par rapport à eBot-CSGO (`!restart` pour revoter le knife round,
`!stop`/`!continue` pour arrêter/reprendre un match en cours par vote), et en profitant de ce travail
pour assainir l'exécution RCON des phases warmup/knife/live, qui est aujourd'hui incohérente et contient
un bug actif.

## Périmètre explicitement exclu

- `!map` (veto de map en jeu) — entre en tension avec le fait que GG-Core fixe déjà les maps à la
  création de la série (`POST /tournaments/:id/series`). Écarté par décision utilisateur.
- `!timeout` distinct de `!pause` — GG-Core distingue déjà `tac`/`tech` avec des raisons différentes
  (`PauseReason: 'tactical' | 'technical'`), jugé suffisant. Écarté par décision utilisateur.
- Commandes purement informatives d'eBot (`!stats`, `!rules`, `!status`, `!connect`, ...) — hors sujet,
  n'impliquent aucun RCON ni configuration.

---

## Bugs / incohérences existants corrigés par ce travail

Découverts en lisant le code actuel (`backend/src/application/match/rules/*.ts`,
`backend/src/application/match/match-orchestrator.service.ts`) :

1. **`LiveRule.onEnter()` exécute les fichiers natifs CS2** (`exec gamemode_competitive.cfg; exec
   gamemode_competitive_tmm`) **au lieu du fichier custom** `ggbot/competitive.cfg` — et ce, *après*
   que `ggbot/competitive.cfg` ait déjà été appliqué ailleurs (`knife.rule.ts` ou `warmup.rule.ts`).
   Les réglages custom (argent, armes autorisées, overtime) risquent donc d'être écrasés par les
   défauts CS2 juste avant le live.
2. **`ggbot/competitive.cfg` est appliqué à trois endroits différents** (`knife.rule.ts` deux fois,
   `warmup.rule.ts` une fois, `live.rule.ts` jamais avec le bon fichier) — aucune source de vérité unique.
3. **`MatchOrchestrator.startWarmup()`** envoie un RCON brut `mp_warmup_start`, redondant avec le
   contenu de `agent/cfg/ggbot/warmup.cfg` qui le fait déjà.
4. **`MatchCommandsService.stopMatch()`** existe mais n'est appelé nulle part (grep confirmé) et sa
   logique est dangereuse : il met `phase = 'postgame'` directement, une phase terminale — un `!stop`
   qui l'utiliserait rendrait le match définitivement impossible à reprendre.
5. **`MatchCommandsService.startLive()`** existe, n'est appelé nulle part, et son nom est trompeur :
   il ne fait qu'un alias d'`unpause()`, sans rapport avec le démarrage du live.
6. **`MatchCommandsService`** contient 4 méthodes stub vides (`runPostgame`, `runOvertime`,
   `runHalftime`, `runLive`) jamais appelées — doublons morts des vraies méthodes de même nom sur
   `MatchOrchestrator`.
7. **Le endpoint agent `/exec`** contient un cas spécial fragile : `if strings.Contains(body.Name,
   "competitive")` déclenche une lecture Redis (`overtimeEnabled`) + un RCON `mp_overtime_enable`
   supplémentaire — logique de bundling correcte dans l'esprit, mais indétectable à la lecture du
   code appelant et couplée à une convention de nommage de fichier plutôt qu'à une action explicite.

---

## Partie 1 — API agent nommée par phase

### Décision d'architecture (validée)
Trois endpoints nommés sur l'agent, remplaçant les usages actuels de `/exec` + RCON brut pour les
transitions de phase. Les fichiers `.cfg` restent la source de vérité éditable (pas de cvars en dur
dans le Go, cf. `docs/ebot-reference.md` — approche hybride, contrairement à eBot qui inline tout).
`/warmup-start` et `/knife-start` sont de purs wrappers aujourd'hui (un seul `exec_cfg`) ; `/live-start`
porte une vraie logique groupée (c'est lui qui corrige le bug n°1-2 ci-dessus).

### Nouveaux endpoints — `agent/cmd/agent/main.go`

```go
// POST /warmup-start  {}
mux.HandleFunc("/warmup-start", func(w http.ResponseWriter, r *http.Request) {
    if !requirePost(w, r) || !checkCmdToken(w, r) { return }
    act := &AgentAction{Action: "exec_cfg"}
    act.Payload.Name = "ggbot/warmup.cfg"
    execHTTP(w, r, act)
})

// POST /knife-start  {}
mux.HandleFunc("/knife-start", func(w http.ResponseWriter, r *http.Request) {
    if !requirePost(w, r) || !checkCmdToken(w, r) { return }
    act := &AgentAction{Action: "exec_cfg"}
    act.Payload.Name = "ggbot/knife.cfg"
    execHTTP(w, r, act)
})

// POST /live-start  {"matchId":"m-xxx","delay":3}
mux.HandleFunc("/live-start", func(w http.ResponseWriter, r *http.Request) {
    if !requirePost(w, r) || !checkCmdToken(w, r) { return }
    var body struct {
        MatchID string `json:"matchId"`
        Delay   int    `json:"delay,omitempty"`
    }
    if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
        http.Error(w, "invalid json", http.StatusBadRequest)
        return
    }
    if body.Delay <= 0 { body.Delay = 3 }

    ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
    defer cancel()

    // 1. Réglages compétitifs (fichier custom GG-Core, pas les fichiers natifs CS2)
    cfgAct := &AgentAction{Action: "exec_cfg"}
    cfgAct.Payload.Name = "ggbot/competitive.cfg"
    if err := execAction(ctx, cfg, cfgAct); err != nil {
        http.Error(w, err.Error(), http.StatusInternalServerError)
        return
    }

    // 2. Overtime depuis matchConfig Redis (logique reprise de l'ancien cas spécial dans /exec)
    if body.MatchID != "" && rdb != nil {
        cfgKey := "match:" + body.MatchID + ":config"
        val, _ := rdb.HGet(ctx, cfgKey, "overtimeEnabled").Result()
        otCmd := "mp_overtime_enable 0"
        if val == "1" { otCmd = "mp_overtime_enable 1" }
        otAct := &AgentAction{Action: "rcon"}
        otAct.Payload.Message = otCmd
        if err := execAction(ctx, cfg, otAct); err != nil {
            log.Printf("[agent:%s] live-start overtime RCON error: %v", cfg.ServerID, err)
        }
    }

    // 3. Warmup off (filet de sécurité) + restart
    endAct := &AgentAction{Action: "rcon"}
    endAct.Payload.Message = "mp_warmup_end"
    execAction(ctx, cfg, endAct)

    restartAct := &AgentAction{Action: "rcon"}
    restartAct.Payload.Message = fmt.Sprintf("mp_restartgame %d", body.Delay)
    if err := execAction(ctx, cfg, restartAct); err != nil {
        http.Error(w, err.Error(), http.StatusInternalServerError)
        return
    }
    writeOK(w)
})
```

Le cas spécial `strings.Contains(body.Name, "competitive")` dans le handler `/exec` existant est
**supprimé** (sa logique est reprise proprement ci-dessus).

### Backend — `AgentClientService` (`backend/src/application/servers/agent-client.service.ts`)

Ajouter, même style que `pause()`/`unpause()`/`initMatch()` :
```typescript
async warmupStart(serverId: string): Promise<void> {
  const { baseUrl, token } = await this.resolve(serverId);
  await this.post(baseUrl, token, '/warmup-start', {});
  this.log.log(`[${serverId}] warmup-start`);
}

async knifeStart(serverId: string): Promise<void> {
  const { baseUrl, token } = await this.resolve(serverId);
  await this.post(baseUrl, token, '/knife-start', {});
  this.log.log(`[${serverId}] knife-start`);
}

async liveStart(serverId: string, matchId: string, delay = 3): Promise<void> {
  const { baseUrl, token } = await this.resolve(serverId);
  await this.post(baseUrl, token, '/live-start', { matchId, delay });
  this.log.log(`[${serverId}] live-start matchId=${matchId}`);
}
```

### Backend — `MatchCommandsService`

Ajouter :
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
Supprimer : l'ancien `startLive()` (alias mort d'`unpause`), `stopMatch()`, et les 4 stubs vides
(`runPostgame`, `runOvertime`, `runHalftime`, `runLive`).

### Backend — `MatchOrchestrator`

- `startWarmup(serverId)` → devient `startWarmup(ids: { serverId?: string; matchId?: string })` et
  délègue à `this.cmds.warmupStart(ids)` (au lieu du RCON brut actuel).
- Ajouter `startKnife(ids)` → délègue à `this.cmds.knifeStart(ids)`.
- Ajouter `startLive(ids, delay?)` → délègue à `this.cmds.startLive({...ids, delay})`.

### Backend — Règles de phase

- **`warmup.rule.ts`** → `launchAfterReady()`, branche map non-décisive : supprimer l'appel
  `execCfg(..., 'ggbot/competitive.cfg')`. Ne garder que le `startPhaseCountdown(..., LIVE_MAIN, ...)`
  — c'est désormais `LiveRule.onEnter()` qui applique les réglages compétitifs.
- **`knife.rule.ts`** → `onEnter()` : remplacer `execCfg(..., 'ggbot/knife.cfg')` par
  `ctx.orch.startKnife({ serverId, matchId: ctx.matchId })`.
  `onTeamRoundWin()` : supprimer les **deux** appels `execCfg(..., 'ggbot/competitive.cfg')` (fallback
  et chemin principal) — plus nécessaires. Garder `startWarmup()` tel quel (il servira maintenant le
  vrai `/warmup-start`).
- **`live.rule.ts`** → `onEnter()` : remplacer les 2 lignes de RCON brut + l'appel séparé
  `restartGame()` par un seul `await ctx.orch.startLive({ serverId, matchId: ctx.matchId })`.

Résultat : **`ggbot/competitive.cfg` n'est plus appliqué qu'à un seul endroit** (`/live-start`, appelé
uniquement depuis `LiveRule.onEnter()`), quel que soit le chemin emprunté (knife puis stay/switch, ou
map non-décisive directe).

---

## Partie 2 — `!restart` (revote du knife round)

### Comportement
Pendant `KNIFE_LIVE` ou `KNIFE_CHOICE` (round couteau en cours, ou décidé mais pas encore choisi),
chaque équipe peut voter `!restart`. Quand CT et T ont voté, le round couteau recommence depuis le
début (mêmes réglages, nouveau round). Usage typique : round invalidé (bug, joueur qui rejoint en
retard) — reprend le comportement d'eBot (`STATUS_KNIFE`/`STATUS_END_KNIFE`).

### État Redis
Nouvelle clé (`redis.keys.ts`) :
```typescript
restartKnifeVote: (m: string) => `match:${m}:restart_knife_vote`, // hash { home, away }
```

### Nouvelles méthodes — `MatchStateService` (même pattern que `addRdyPlayer`/`clearRdyPlayers`)
```typescript
async setRestartVote(matchId: string, team: 'home' | 'away'): Promise<void> {
  await this.redis.hset(redisConst.restartKnifeVote(matchId), team, '1');
}
async getRestartVotes(matchId: string): Promise<{ home: boolean; away: boolean }> {
  const v = await this.redis.hgetall(redisConst.restartKnifeVote(matchId));
  return { home: v.home === '1', away: v.away === '1' };
}
async clearRestartVote(matchId: string): Promise<void> {
  await this.redis.del(redisConst.restartKnifeVote(matchId));
}
```

### Nouveau fichier — `backend/src/application/match/commands/restart-knife.command.ts`
```typescript
@Injectable()
export class RestartKnifeCommand extends BaseCommand {
  async canHandle(event: CommandEvent, ctx: RuleContext): Promise<boolean> {
    if (event.payload.command !== 'restart') return false;
    const team = await ctx.orch.sideToLogical(event.matchId, event.payload.sender.team);
    return !!team;
  }

  async handle(event: CommandEvent, ctx: RuleContext): Promise<boolean> {
    const team = await ctx.orch.sideToLogical(event.matchId, event.payload.sender.team);
    if (!team) return false;

    await ctx.state.setRestartVote(event.matchId, team);
    await ctx.say(`[knife] ${event.payload.sender.name} (${team}) veut relancer le knife round.`);

    const votes = await ctx.state.getRestartVotes(event.matchId);
    if (votes.home && votes.away) {
      await ctx.state.clearRestartVote(event.matchId);
      await ctx.say('[knife] Les deux équipes sont d\'accord — relance du knife round.');
      const serverId = event.serverId ?? await ctx.state.getServerIdFromMatchId(event.matchId);
      if (serverId) {
        await ctx.orch.startPhaseCountdown(event.matchId, MatchPhase.KNIFE_LIVE, 3, serverId);
      }
    }
    return true;
  }
}
```

### Câblage
- `KnifeRule` (`knife.rule.ts`) : le constructeur actuel ne prend aucune dépendance
  (`constructor() { super(); ... }`) — ajouter `constructor(private readonly restartCmd: RestartKnifeCommand)`,
  puis `this.commands.set('restart', this.onRestartCommand.bind(this))` qui délègue à `this.restartCmd.handle(...)`.
- `KnifeChoiceRule` (`knife-choice.rule.ts`) : même ajout de dépendance au constructeur, même câblage,
  **même instance** de `RestartKnifeCommand` que celle passée à `KnifeRule` (partagée, comme
  `KnifeChoiceCommand` l'est déjà pour `KnifeChoiceRule` seul).
- `RuleRegistry` (`rule.registry.ts`) : ajouter `RestartKnifeCommand` aux dépendances injectées dans
  le constructeur de `RuleRegistry`, et l'passer à `new KnifeRule(this.restartCmd)` (au lieu du
  commentaire actuel `/* passez ici ses dépendances si besoin */`) et `new KnifeChoiceRule(this.knifeCmd,
  this.restartCmd)`.

La ré-entrée dans `KNIFE_LIVE` déclenche `KnifeRule.onEnter()` qui réinitialise déjà l'état en mémoire
(`this.state.set(matchId, {...})`) et rappelle `orch.startKnife()` (→ `/knife-start`) — pas de code de
reset supplémentaire nécessaire.

---

## Partie 3 — `!stop` / `!continue` (arrêt/reprise votés)

### Comportement
Pendant `LIVE_MAIN` ou `OVERTIME`, chaque équipe peut voter `!stop`. Quand CT et T ont voté, le match
est mis en pause **indéfiniment** (pas de banque, pas d'auto-reprise — contrairement aux pauses
tactiques/techniques). `!continue` fonctionne pareil en sens inverse pour reprendre.

Remplace l'actuel `MatchCommandsService.stopMatch()` (jamais câblé, dangereux — voir bugs ci-dessus).

### `PauseReason` — `backend/src/application/match/pause/pause.service.ts`
Ajouter `'stopped'` à l'union `PauseReason` (`'tactical' | 'technical' | 'stopped'`). Un pause
`reason: 'stopped'` ne doit jamais être armée automatiquement (`armAutoUnpause` n'est jamais appelé
pour cette raison) et ne consomme aucune banque de temps-mort.

### État Redis
```typescript
stopMatchVote: (m: string) => `match:${m}:stop_vote`, // hash { home, away }
```
Une seule clé, dont le sens dépend de l'état courant de pause (comme `canHandle` le fait déjà pour
`pause`/`unpause` dans `PauseCommand`) : tant que `reason !== 'stopped'`, un vote enregistré ici veut
dire "je veux arrêter" ; une fois `reason === 'stopped'`, un vote dans la **même** clé veut dire "je
veux reprendre". La clé est vidée à chaque bascule réussie (stop effectif, ou reprise effective), donc
il n'y a jamais d'ambiguïté sur ce que représentent les votes présents à un instant donné.

### Nouveau fichier — `backend/src/application/match/commands/stop-match.command.ts`
Même structure que `PauseCommand` (dual-commande `stop`/`continue`), avec les mêmes méthodes d'état
que `!restart` (`setStopVote`/`getStopVotes`/`clearStopVote` sur `MatchStateService`, même pattern) :
- `canHandle` : commande = `stop` ou `continue`, sender dans CT/T. Refuse `stop` si déjà arrêté
  (`pauseService.getPauseState(matchId).reason === 'stopped'`), refuse `continue` si pas arrêté.
- `handle('stop')` : enregistre le vote de l'équipe. Si les deux ont voté :
  `orch.pause.pause(matchId, serverId, { reason: 'stopped', team: 'system', armOnly: false })` +
  `cmds.pause({ serverId, matchId })` (RCON réel, réutilise `/pause` existant) ; vide le vote.
- `handle('continue')` : enregistre le vote. Si les deux ont voté :
  `orch.resume({matchId, serverId}, {source: 'chat', reason: 'stopped'})` (réutilise `/unpause`
  existant) ; vide le vote.

### Câblage
- `LiveRule` (`live.rule.ts`) : ajouter `this.commands.set('stop', ...)`, `this.commands.set('continue', ...)`,
  injecter `StopMatchCommand` au constructeur (déjà pris `PauseCommand` — ajouter en second paramètre),
  délègue (même pattern que `pause`/`unpause`/`tac`/`tech` existants).
- `RuleRegistry` : `MatchPhase.OVERTIME` n'est **pas actuellement mappée** dans `rules` (elle retombe
  sur `warmupRule` par défaut, via le fallback de `getRule()`) — donc `!stop`/`!continue` ne fonctionnent
  aujourd'hui que pendant `LIVE_MAIN`. C'est le périmètre retenu pour cette itération ; étendre à
  `OVERTIME` nécessiterait de mapper explicitement cette phase vers `liveRule` (ou une règle dédiée),
  ce qui est un changement séparé, hors périmètre ici.

---

## Gestion d'erreurs

- Si l'agent est injoignable lors d'un appel `/warmup-start`, `/knife-start` ou `/live-start` :
  le comportement suit la convention déjà en place ailleurs dans le code (ex.
  `series-create.controller.ts`) — logger un warning, ne pas faire échouer toute la transition. Pas
  de rollback de phase automatique (limite connue, cohérente avec le reste du codebase).
- Vote `!restart`/`!stop`/`!continue` : si un joueur quitte après avoir voté, son vote reste enregistré
  (pas de nettoyage auto sur déconnexion) — limite acceptée pour cette itération, à noter comme dette.

## Tests à ajouter/adapter (Jest, colocalisés)

- `restart-knife.command.spec.ts` (nouveau)
- `stop-match.command.spec.ts` (nouveau)
- `knife.rule.spec.ts` : adapter les mocks orchestrateur (ajouter `startKnife`, retirer les attentes sur
  `execCfg('ggbot/competitive.cfg')` dans `onTeamRoundWin`), ajouter cas `!restart`
- `live.rule.spec.ts` : adapter pour `startLive` au lieu du RCON brut + `restartGame` séparé
- `warmup.rule.spec.ts` : retirer l'attente d'`execCfg('ggbot/competitive.cfg')` dans le cas map
  non-décisive
- Go : pas de suite de tests existante pour l'agent : valider `go build ./cmd/agent` (voir
  `scripts/check.sh`) + tests manuels `curl` (mêmes commandes que `docs/plans/admin-actions-api.md`)

## Ordre d'implémentation suggéré
1. Endpoints agent (`/warmup-start`, `/knife-start`, `/live-start`) + suppression du cas spécial dans `/exec`
2. `AgentClientService` + `MatchCommandsService` (nouvelles méthodes, suppression des méthodes mortes)
3. `MatchOrchestrator.startWarmup/startKnife/startLive`
4. Câblage des règles (`warmup.rule.ts`, `knife.rule.ts`, `live.rule.ts`) — supprime le bug n°1
5. `!restart` (état Redis + commande + câblage `KnifeRule`/`KnifeChoiceRule`)
6. `!stop`/`!continue` (nouveau `PauseReason`, état Redis + commande + câblage `LiveRule`)
7. Tests + `scripts/check.sh --no-smoke`
