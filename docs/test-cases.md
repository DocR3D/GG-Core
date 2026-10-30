# Cas de test - GG-Core

Cas de test dérivés des logs réels observés lors d'une session de jeu sur `srv-a` (match `m-7ef15f093f`), puis tests sur
serveur CS2 réel (fin de fichier : validés et **en suspens**).

---

## TC-01 - Résolution matchId depuis serverId

**Contexte :** Tous les événements CS2 arrivent avec `matchId="unknown"`.
Le backend doit résoudre le vrai matchId depuis le `serverId` via Redis (`server:{serverId}:currentMatch`).

**Observé dans les logs :**
```json
{"type":"round_start","matchId":"unknown","serverId":"srv-a"}
{"type":"kill","matchId":"unknown","serverId":"srv-a"}
```

**Comportement attendu :** Le backend résout `matchId` → `"m-7ef15f093f"` et route l'event vers le bon match.

**Comportement actuel (BUG) :** `cs2-logs.service.ts` ne gère pas `matchId="unknown"` (condition `!ev.matchId` est fausse car `"unknown"` est truthy). Les events arrivent donc toujours avec `matchId="unknown"` dans le bus Redis.

**Fix :** Dans `cs2-logs.service.ts` ligne 38, changer :
```typescript
if (!ev.matchId && ev.serverId)
// en :
if ((!ev.matchId || ev.matchId === 'unknown') && ev.serverId)
```

**Vérification :** Après init match + liaison `srv-a`, les events CS2 doivent avoir `matchId` correctement renseigné dans le bus.

---

## TC-02 - Flow complet knife → knife_choice → live_main

**Contexte :** Flow le plus critique du lifecycle. Observé en entier dans les logs.

**Séquence observée :**
1. `round_freeze_start` (warmup)
2. `round_start` (knife round)
3. `kill` (CT tue T au couteau)
4. `team_round_win` `{ winner: "CT", reason: "elim" }`
5. → Backend répond : `"[knife] Gagnant knife: CT (homeDeaths=0, awayDeaths=1)"`
6. → `exec_cfg knife_undo.cfg`
7. → `phase_changed` → `knife_choice`
8. `command` `{ command: "stay" }` depuis Garitos (CT)
9. → `"[knife] Choix: STAY. Passage au live…"`
10. → countdown 5s (5, 4, 3, 2, 1)
11. → `phase_changed` → `live_main`
12. → `exec gamemode_competitive.cfg`, `restart` (delay 3s)

**Comportement attendu :** Chaque étape se déroule dans l'ordre. La phase passe de `knife_live` → `knife_choice` → `live_main`.

**À vérifier :**
- Phase Redis `match:{id}:phase` = `"knife_choice"` après `team_round_win`
- Phase Redis `match:{id}:phase` = `"live_main"` après `!stay`
- Action RCON `exec ggbot/knife_undo.cfg` envoyée exactement 1 fois

---

## TC-03 - Pause tactique en phase live_main

**Contexte :** Joueur tape `!pause` pendant `live_main`.

**Observé dans les logs :**
```json
{"type":"command","payload":{"command":"pause","sender":{"name":"Garitos","team":"CT"}}}
→ action say: "Impossible de mettre en pause : le match est terminé."
```

**Comportement attendu :** La pause doit être armée (déclenchée à la prochaine freeze time).

**Comportement actuel (BUG) :** `pause.command.ts` appelle `pauseService.getPhase()` qui lit `match:{id}:phase` = `"live_main"`. Cette valeur ne correspond ni à `'live'` ni à `'freeze'`, donc le code tombe dans le fallback "match terminé".

**Fix :** `pause.command.ts` doit lire la `RoundPhase` (clé `match:{id}:roundPhase`) au lieu de la `MatchPhase`. En `live_main`, la `RoundPhase` vaut `'live'` ou `'freeze'` selon le moment.

**Vérification :**
- `!pause` pendant un round actif → réponse "Pause armée" + clé Redis armée
- `!pause` pendant freeze time → pause immédiate + RCON `mp_pause_match`

---

## TC-04 - Commande inconnue (!tec au lieu de !tech)

**Observé dans les logs :**
```json
{"type":"command","payload":{"command":"tec","parameters":[],"sender":{"name":"Garitos","team":"CT"}}}
```
→ Aucune réponse (ignoré silencieusement)

**Comportement attendu :** Le système ignore silencieusement les commandes non reconnues - c'est le comportement correct.

**À vérifier :** Pas d'erreur levée, pas de crash, log debug acceptable.

---

## TC-05 - Kill world avec victime = nom de map (faux kill)

**Observé dans les logs :**
```json
{"type":"kill","payload":{"cause":"Match_Start","kind":"world","victim":{"name":"de_inferno","steamId":"","team":"Unassigned"}}}
```
→ Backend log : `[knife][warn] team inconnu pour de_inferno: undefined`

**Contexte :** CS2 envoie un faux kill `Match_Start` avec le nom de la map comme victime lors d'un restart. Ce n'est pas un vrai kill.

**Comportement attendu :** Ignoré sans avertissement visible en production (ou filtré avant dispatch).

**Comportement actuel :** Traité comme un kill → avertissement inutile dans le chat ingame.

**À vérifier :** `kill` avec `steamId=""` et `team="Unassigned"` doit être ignoré (guard dans `knife.rule.ts` ou dans le parser).

---

## TC-06 - Déconnexion joueur en cours de round

**Observé dans les logs :**
```json
{"type":"player_disconnect","payload":{"player":{"name":"Garitos","steamId":"[U:1:37924580]"},"reason":"NETWORK_DISCONNECT_DISCONNECT_BY_USER"}}
{"type":"kill","payload":{"kind":"suicide","player":{"name":"Garitos","team":"CT"},"weapon":"world"}}
{"type":"team_round_win","payload":{"reason":"elim","winner":"T"}}
```

**Comportement attendu :** Round attribué à T, score mis à jour, `score:update` envoyé via WS.

**À vérifier :**
- Score T incrémenté de 1 dans Redis (`match:{id}:score`)
- Event `score:update` diffusé via WebSocket
- Pas de crash si le joueur déconnecté était le dernier de son équipe

---

## TC-07 - Round gagné par désamorçage (defused)

**Observé dans les logs :**
```json
{"type":"team_round_win","payload":{"reason":"defused","winner":"CT"}}
```

**Comportement attendu :** Score CT incrémenté, `score:update` WS envoyé.

**À vérifier :** `live.rule.ts` → `onTeamRoundWin()` → `roundEnd()` → `addPoint(matchId, "CT")`.

---

## TC-08 - Messages périodiques en knife_choice

**Observé dans les logs :**
```
say: ">>> TeamA vs TeamB <<<"
say: ">>> TeamA a remporté le knife round<<<"
say: "Tapez !ready quand vous êtes prêts."
```
(répétés toutes les ~20s)

**Comportement attendu :** Messages envoyés à intervalle régulier en mode Chain.

**À vérifier :**
- Messages stoppés automatiquement à la transition vers `live_main`
- Pas de messages en doublon si la phase est changée rapidement

---

## TC-09 - Init match et liaison serveur

**Prérequis pour tous les autres tests.**

**Séquence :**
1. `POST /api/matches/init` avec `{ matchId, serverId }`
2. Vérifier Redis : `server:srv-a:currentMatch` = `matchId`
3. Vérifier Redis : `match:{matchId}:server` = `"srv-a"`

**Comportement attendu :** Après init, tous les events CS2 de `srv-a` sont routés vers le bon match.

**À vérifier :**
- Clé Redis créée sans TTL (persistante pendant le match)
- `getMatchIdFromServerId("srv-a")` retourne le bon matchId

---

## Bugs tracés depuis les logs (historique)

| ID | Fichier | Bug | Statut |
|----|---------|-----|--------|
| B-01 | `cs2-logs.service.ts:38` | `!ev.matchId` ne catch pas `"unknown"` | ✅ corrigé (`8650cf3`) |
| B-02 | `pause.command.ts:82` | Lit `MatchPhase` au lieu de `RoundPhase` | ✅ corrigé (`8650cf3`) ; armement étendu à `bomb_planted` / `end` (`44f0b0a`) |

---

## Tests sur serveur CS2 réel (`make up-cs2`)

Les tests Jest et le Golden Master rejouent des logs : ils ne voient pas ce que GG-Core **envoie** au serveur. Ces
tests-ci pilotent un vrai CS2 dédié (conteneur `ggcore-cs2-dev`) uniquement via les API de GG-Core.

**Mise en place** : `make up-cs2`, puis `POST /api/matches/<id>/start` (`serverId: "srv-a"`, `settings`), bots via
`POST /sandbox/rcon` (`bot_quota_mode fill; bot_quota 4`), `!ready` des deux capitaines via
`POST /sandbox/simulate/command` (SteamID distinct par camp). Format court pour aller vite :
`settings: { knifeEnabled: false, mrFormat: 2, overtimeMrFormat: 1 }` (mi-temps au round 2, victoire à 3, OT en MR1).
Suivre les logs : `docker logs -f ggcore-cs2-dev` (serveur) et `docker logs -f ggbot-manager` (RCON envoyé).

### ✅ Validés (2026-10-29 avec un joueur humain, 2026-10-30 avec bots)

| Scénario | Attendu / observé |
|---|---|
| Connexion, `!ready` réels (say_team), knife + `!switch` | live lancé, côtés échangés une seule fois |
| `!pause` en round → appliquée au freeze ; `!unpause` ; `!tech` au freeze | pause armée puis appliquée, banque débitée |
| Restauration de backup native CS2 | score, K/D et séries ramenés au round restauré |
| Déconnexion, mort par la C4, suicide molotov | K/D identiques au TAB / `round_stats` |
| Mi-temps native | CS2 inverse seul, score serveur conservé (2:0 → 0:2), **aucun** `mp_swapteams` / `mp_restartgame` envoyé |
| Prolongations natives | swap de mi-OT, OT1 → OT2 → OT3 sans nul (`mp_overtime_limit 0`) |
| Fin de match | annonce du vainqueur = `Game Over` serveur, reset warmup à +30 s (`postgameResetDelaySec`) |
| Game Over serveur vs GG-Core | replay d'une fixture : « server Game Over 11:13 confirms GG-Core » |
| Démo GOTV | `.dem` écrite (`tv_enable 1` + `TV_ENABLE=1` du conteneur) |
| Rate-limit RCON | 1 seule connexion RCON, ≤ 3 commandes/s reçues par le serveur (limite 6/s) |
| Sandbox | 2 capitaines acceptés ; replay refusé (409) si le serveur fait tourner un autre match non terminé |

### ⏳ En suspens (joueur humain connecté requis)

| ID | Scénario | Procédure | Attendu |
|---|---|---|---|
| RT-01 | `!pause` après la pose de bombe | pendant un round, poser la C4 puis taper `!pause` | « Pause … armée », appliquée au freeze suivant (plus de « match terminé ») |
| RT-02 | `!tech` en fin de round | taper `!tech` entre la fin du round et le freeze | pause technique armée puis appliquée au freeze |
| RT-03 | Affichage de la banque de pause | `!pause` au freeze, lire le rappel périodique | « banque restante » part de `tacticalPauseBankSec` (120 s par défaut), jamais 0:00 |
| RT-04 | TAB pendant l'entracte de fin | finir un match, tenir TAB | écran de fin et scoreboard visibles ~25 s, joueurs non figés, warmup seulement à +30 s |
| RT-05 | Kick post-match | rester connecté après la fin du match | kick à +120 s (`postgameKickDelaySec`) avec « Match terminé, merci d'avoir joué ! » ; GOTV et bots non kickés |
| RT-06 | Kick annulé par un nouveau match | démarrer un nouveau match sur le serveur avant les 120 s | aucun kick |
| RT-07 | Fin de la démo GOTV | lire la démo d'un match terminé (`playdemo`) | le dernier round est présent malgré `tv_delay 105` et le `tv_stoprecord` envoyé au Game Over |
| RT-08 | Navigation round par round (UI Sandbox) | `/sandbox`, vitesse « Round par round », suivant / précédent / aller au round N | score et scoreboard conformes au log à chaque étape |
| RT-09 | Sides choisis au véto (mode « pick », sans knife) | véto avec choix de side (`make veto-demo`), lancer le game, les joueurs rejoignent le mauvais camp | à coder d'abord (todo §3) : swap des équipes si les deux capitaines sont inversés, lancement bloqué sinon ; noms d'équipe du bon côté **après** le swap |
| RT-10 | `mp_swapteams` et noms d'équipe | `mp_teamname_1` / `mp_teamname_2` posés, puis `mp_swapteams` en warmup | observer si les noms suivent les équipes ou restent sur leur camp (décide si GG-Core doit les reposer après un swap) |
