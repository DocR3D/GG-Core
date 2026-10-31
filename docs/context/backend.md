# Backend NestJS - Contexte

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

### 1. Domain (`src/domain/`) - Métier pur, framework-agnostic

**Events**
- `events/base.event.ts` - `BaseEvent<TType, TPayload>` (v, id, timestamp, source, kind, serverId, matchId, map, round, tick, type, payload)
- `events/event.types.ts` - `EventTypes` constantes (30+ types)
- `events/match.event.ts` - Types événements match (RoundStartEvent, KillEvent, TeamRoundWinEvent, BombPlantedEvent, etc.)
- `events/chat.event.ts` - ChatEvent
- `events/command.event.ts` - CommandEvent + `buildCommandEvent()`
- `events/internal-events.ts` - InternalEvent + Audience (`public | admin | both`)

**Rules & Context**
- `rules/base.rule.ts` - Interface `PhaseRule` (onEnter, onExit, say, canHandle, handle, canHandleCommand, handleCommand)
- `rules/rule-context.ts` - `RuleContext` (matchId, serverId, state, orch, say)
- `phase.types.ts` - `MatchPhase` enum + `RoundPhase` enum

**Types**
- `commands/base.command.ts` - `ICommand` interface (canHandle, handle)

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
match:{id}:phase         - MatchPhase courante
match:{id}:roundPhase    - RoundPhase courante (séparée !)
match:{id}:sides         - hash { home, away } (CT/T)
match:{id}:score         - hash { ct, t, round, phase }
match:{id}:pause         - hash { state, reason, team, started_at, tac_bank_home, tac_bank_away }
match:{id}:teams         - hash { ct_id, t_id, home_id, away_id, ct_name, t_name, home_name, away_name }
match:{id}:lineup:home   - list steamIds
match:{id}:lineup:away   - list steamIds
match:{id}:money         - hash steamId→montant
match:{id}:equip         - hash steamId→montant
match:{id}:economy:team  - hash (loss streak, bonus)
match:{id}:ready         - hash { home, away } (0/1)
match:{id}:phase:lock    - lock anti-doublon countdown
match:{id}:phase:pending - phase en attente de countdown
match:{id}:knife_winner_side    - 'CT' | 'T'
match:{id}:knife_winner_logical - 'home' | 'away'
match:{id}:knife_choice         - 'pending' | 'stay' | 'switch'
server:{serverId}:currentMatch  - matchId courant
match:{id}:server               - serverId courant
match:{id}:db_match_map         - UUID du MatchMap PostgreSQL lié (optionnel)
```

#### Match Orchestration

**`match-orchestrator.service.ts`** - Facade principale
- `requestPauseTactical()` - pause tactique (armée ou immédiate selon RoundPhase)
- `resume()` - reprise manuelle ou auto-expire
- `applyPauseIfArmed()` - consomme pause armée à la freeze time
- `execCfg()` / `execCfgs()` - applique un .cfg GG-Core (`agent/cfg/ggbot`) **via l'agent** (`exec_cfg`) ; jamais en `exec` RCON brut (ces fichiers n'existent pas sur le serveur)
- `startMatch()` - `tv_enable 1`, changelevel, warmup.cfg, `tv_record`, banques de pause (`tacticalPauseBankSec`), phase initiale
- `endMatch()` - annonce, `tv_stoprecord`, progression bracket, puis **différé** : reset warmup à `postgameResetDelaySec` (30 s) et kick des joueurs à `postgameKickDelaySec` (120 s, 0 = off), ignorés si un autre match a démarré sur le serveur
- `onServerGameOver()` / `checkServerGameOver()` / `resolveReview()` - arbitrage du `Game Over` serveur : score = serveur, verdict = règlement GG-Core ; désaccord → résultat gelé (`match:{id}:review`) en attendant l'admin
- `onFreezeTimeStart()` / `onRoundStart()` / `onRoundEnd()` / `onBombPlanted()` - lifecycle round
- `push()` - broadcast WS
- `applyKnifeResult()` / `swapSides()` / `setPhase()` / `startPhaseCountdown()`

**`match-phase.service.ts`** - Transitions de phase
- `startPhaseCountdown()` - countdown avec lock Redis anti-doublon
- `cancelPhaseCountdown()` - annule un countdown
- `setPhase()` / `getPhase()` - MatchPhase (clé `match:{id}:phase`)
- `setRoundPhase()` / `getRoundPhase()` - RoundPhase (clé `match:{id}:roundPhase`) ← clé SÉPARÉE
- `isBothReady()` / `setReady()`

#### Règles de phase (`match/rules/`)

| Règle | Phase | Gère |
|-------|-------|------|
| `warmup.rule.ts` | `warmup_main` / `warmup_knife` | `!ready`/`!unready`, countdown vers knife |
| `knife.rule.ts` | `knife_live` | Kills → tie-break deaths → winner → `KNIFE_CHOICE` |
| `knife-choice.rule.ts` | `knife_choice` | `!stay`/`!switch`/`!swap` |
| `live.rule.ts` | `live_main` | Round start/end, kills, pauses, score |

#### Commandes chat (`match/commands/`)
- `ready.command.ts` - `!ready`, `!unready`
- `pause.command.ts` - `!pause`, `!tac`, `!tech`, `!unpause`
- `knife-choice.command.ts` - `!stay`, `!switch`

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
| `POST /api/tournament/matches/:id/games/:order/result` | **Saisie admin** du résultat du game n° `order` d'une série (Match en base, UUID) : `{ scoreHome, scoreAway, mapName? }` (auteur = l'admin de la session, jamais un nom envoyé dans la requête) → game `MANUAL` / `CONFIRMED`, puis mise à jour de la série (BO1/BO3/BO5) et de l'arbre. 404 match inconnu, 409 série terminée, 400 saisie invalide |
| `GET /api/tournament/servers` · `POST /api/tournament/servers` | Serveurs de jeu avec disponibilité (`free` / `busy` + match en cours / `disabled`) et état de leur agent (`agent` : `online`, `rconConnected` / `rconError`, `lastLogAt`, `lastBadTokenAt`) · enregistrer un serveur (`{ name: id de l'agent, ip, port?, tvPort? (GOTV, 27020), game? }`) |
| `POST /api/tournament/servers/:id/disable` \| `enable` \| `release` | Désactiver un PC mort (jamais choisi) / le remettre en service / **libérer** un serveur bloqué sur un match qui ne finira jamais |
| `POST /api/tournament/matches/:id/forfeit` | Forfait `{ absentTeamId }` : chaque map qui manque à l'autre équipe devient un game gagné 13-0 (auteur « forfait », compté dans la différence de score des poules ; map du véto conservée), puis série terminée, games restants annulés, arbre. 409 si un game est en cours sur un serveur |
| `POST /api/tournament/matches/format` | Format à la volée `{ matchIds: [...] }` ou `{ stageId, bracket?: UPPER\|LOWER\|FINAL }` + `format` : seulement les matchs pas commencés, véto commencé effacé ; grande finale jamais en BO1. Répond `changed`, `vetoReset`, `skipped` (avec la raison) |
| `POST /api/tournament/matches/:id/replace-team` | `{ teamId, newTeamId }` dans un match pas commencé (véto effacé) |
| `POST /api/tournament/tournaments/:id/bonus-matches` · `DELETE /api/tournament/bonus-matches/:id` | Match bonus entre deux équipes du tournoi `{ homeTeamId, awayTeamId, format?, placement?, countsInStats? }` : fun (nul permis, hors stats par défaut) ou pour une place (`placement: 7` = 7e / 8e : vainqueur obligatoire, compte dans les stats, départage au classement final les équipes ex aequo sur cette place). Suppression tant qu'il n'est pas commencé |
| `POST /api/tournament/matches/:id/games/:order/launch` | Lancer le game n° `order` d'une série sur un serveur choisi : `{ server?, mapName?, settings? }` (sans `server` : le premier serveur libre par nom, activé, du bon jeu, sans match en cours et dont l'agent est connecté en RCON ; 409 s'il n'y en a aucun) (après un véto : `mapName` facultatif = map du véto, et en mode de side « pick » les sides choisis au véto, sans knife, avec `fixedSides` : quand les deux équipes sont prêtes, chaque joueur des rosters doit être dans son camp - suivi des lignes `switched from team` - sinon `mp_swapteams` si les deux équipes sont inversées, ou live bloqué ; noms d'équipe posés ensuite par `mp_teamname_1/2`). Le moteur temps réel utilise l'UUID du game comme matchId : le résultat remonte seul (game → série → arbre). Relancer sur un autre serveur après un crash = même appel. 409 si serveur désactivé / occupé / jeu différent. **Accès** (par défaut, `access: { password: false, whitelist: false }` pour s'en passer) : nouveau mot de passe aléatoire posé par `sv_password`, et whitelist = tout le roster des deux équipes dans le tournoi (titulaires et remplaçants) + `GG_ADMIN_STEAMIDS` ; whitelist laissée de côté si une équipe n'a aucun SteamID (elle kickerait toute l'équipe). Réponse : `connect` (ligne console), `whitelist` (`{ players, admins }` ou `{ off: raison }`) |
| `/sandbox/tournament` | **Tournois simulés** (outil de dev, page HTML sans JS) : un scénario JSON de `test/fixtures/tournaments` joué en accéléré - équipes, joueurs et stats CS2 factices, résultats déterministes, games « en cours » pendant `delayMs`, N séries en parallèle, pause / reprendre / game suivant / arrêter. API : `GET scenarios`, `GET\|POST runs`, `GET runs/:id`, `POST runs/:id/(pause\|resume\|step\|stop)`. Relancer un scénario remplace son tournoi. Suivi en direct : `/view/tournaments/:id?refresh=N` |
| `GET /api/tournament/tournaments/:id/overview` | Données JSON des pages `/view` (phases, poules, classements, arbres, matchs, games, serveurs, classement final) |
| `GET /api/tournament/tournaments/:id/teams` | Équipes du tournoi (roster, place dans une phase ou match) avec leurs joueurs : `id`, `username`, `steamId`, `captain`, `role` |
| `GET /api/tournament/matches/:id` | Détail d'une série en JSON (le même que `/view/matches/:id`) : équipes avec `homeId` / `awayId`, games avec `id` (= matchId du moteur, pour la console), provenance et suite dans l'arbre, stats |
| `GET /api/tournament/live` | Tous les games en cours (tableau de bord admin) : série et équipes, tournoi, serveur, map, et du moteur temps réel la phase, le score par équipe (`score.home` / `away`, `round`), la pause, un résultat gelé (`review`) |
| `POST /api/matches/:id/pause` \| `unpause` \| `force-start` \| `swap-teams` \| `restore { round }` \| `say { message }` | **Console de match** (admin, `:id` = game du moteur). Pause technique (409 si déjà en pause) ; reprise (la pause de GG-Core, ou seulement celle du serveur après un restore) ; départ sans attendre les `!ready` (warmups, camps du véto contrôlés d'abord) ; échange des camps avant le live (GG-Core suit les équipes ; refusé avec des sides du véto) ; rejouer le round N (`mp_backup_restore_load_file backup_round(N-1).txt` : vérifié sur le serveur, `backup_round05.txt` = état après 5 rounds ; CS2 met le match en pause ensuite) ; message `[Admin]` dans le chat. Chaque action passe par le moteur, est enregistrée avec son auteur (session) dans `events_primary` (type `admin_action`) et poussée aux admins (`admin:action`). Redémarrer / changer de carte = relancer le game |
| `GET /api/matches/:id/events?limit=` | Journal du match, du plus ancien au plus récent (admin seulement, 403 sinon : il contient le chat, les logs bruts et les actions admin) : la console l'affiche à l'ouverture puis suit le WebSocket |
| `GET /api/matches/:id/review` | Résultat gelé (désaccord `Game Over` serveur / GG-Core) ou `null` |
| `POST /api/matches/:id/review/accept-server` \| `.../review/dismiss` | Décision admin : prendre le score du serveur et terminer le match (un nul reste un nul), ou lever le gel |
| `POST /api/matches/init` | Compat smoke tests CI (`matchId` dans le body) |
| `GET /api/matches/:id/players` | Joueurs du match |
| `GET /api/matches/:id/economy` | Économie |
| `GET/PATCH /api/matches/:id/sides`, `PATCH .../sides/swap` | Sides |
| `/sandbox`, `/sandbox/*` | Console Sandbox / Round Doctor : `inject`, `simulate/round-win`, `simulate/command`, `rcon`, `restore-ingame`, `replay/raw-log`, `replay/scenario`, `replay/rounds/start`, `replay/rounds/step`, `replay/rounds/:matchId`, `fixtures`, `state/:matchId`. Un replay pilote aussi le vrai serveur (voulu : reproduire un bug) ; il est refusé (409) si le serveur fait tourner **un autre** match non terminé |

**Authentification (V1)** - `AuthService` + contrôle d'accès au niveau Express (`main.ts`, toutes les routes) :
- public : lectures (`GET`/`HEAD`) hors Sandbox, `/login`, `/auth/*`, `/api/health` ; `/cs2/logs` (jeton de logs de l'agent) et `/ws` (garde JWT) ont leur propre authentification ;
- admin : toute modification (`POST`/`PUT`/`PATCH`/`DELETE`) et le Sandbox - navigateur non connecté redirigé vers `/login`,
  connecté sans le droit : page « Réservé aux admins » (403) ; API → 401 (non connecté) / 403 (pas admin) ;
- `/login` n'est proposé qu'à un visiteur non connecté (connecté : renvoyé vers `next`) ; changer de compte = se
  déconnecter (barre du site : nom + « Se déconnecter ») ;
- `GET /login` (page), `GET /auth/steam` → Steam OpenID → `GET /auth/steam/return` (assertion vérifiée auprès de Steam, rôle selon le SteamID : admin si dans `GG_ADMIN_STEAMIDS`, joueur si SteamID connu, sinon visiteur), `POST /auth/local` (mot de passe admin hors ligne `GG_ADMIN_PASSWORD`), `GET /auth/logout`, `GET /auth/me` ;
- session : JWT signé (`JWT_SECRET`) dans un cookie HttpOnly (24 h) ; scripts / curl : `Authorization: Bearer <GG_ADMIN_TOKEN>`.
- mot de passe admin hors ligne : 10 essais par minute et par adresse au plus (fenêtre courte : derrière la redirection de
  ports Docker, tous les navigateurs peuvent avoir la même adresse, celle de la passerelle).

**Pages humaines (hors `/api`, réservé à l'API JSON)** - HTML simple sans JS (vues de tournoi en `<pre>`) :
- `GET /view` : liste des tournois ;
- `GET /view/tournaments/:id` : vue ASCII d'un tournoi (poules, classements, arbres en colonnes avec la progression, matchs, games, serveurs, qualifiés, matchs bonus, classement final) ; chaque libellé de match est un lien ; `?refresh=N` recharge toutes les N s ; `GET /view/tournaments/:id.txt` = même texte brut (pour `curl`) ;
- `GET /view/matches/:id` : détail d'un match (série, games avec auteur / serveur, stats joueurs, provenance et suite dans l'arbre, cliquables, lien vers le véto) ; pour chaque game en cours, bouton **« Se connecter »** (`steam://connect/ip:port/mot de passe`, ouvre CS2 sur le serveur) et la ligne console `connect …; password …`, montrés **seulement** aux admins et aux joueurs des deux rosters connectés avec Steam ; pour tous les autres (et en secondaire pour les admins), **« Regarder (GOTV) »** (`steam://connect/ip:tv_port`, GOTV ouverte par GG-Core avec `tv_password ""`, en différé `tv_delay`) ;
- `GET /veto/:matchId` : pierre-feuille-ciseaux puis véto des maps (voir ci-dessous) ;
- `GET /sandbox`, `GET /sandbox/tournament` : outils de dev (Sandbox de match, tournois simulés).

**Pierre-feuille-ciseaux et véto des maps** (`application/tournament/veto.service.ts`, domaine pur `domain/tournament/veto.ts`) :
- configuration admin : `PUT /api/tournament/tournaments/:id/veto` (défaut du tournoi) ou `PUT /api/tournament/stages/:id/veto`
  (prioritaire) `{ mapPool: [...], sideMode: 'knife' | 'pick' }` - knife : knife round sur chaque map ; pick : sur une map
  pickée l'adversaire du pickeur choisit son side, knife sur le decider ;
- capitaines désignés par l'admin : `POST /api/tournament/tournaments/:id/teams/:teamId/players`
  `{ players: [{ username, steamId?, captain? }] }`, `PUT …/teams/:teamId/captain { playerId }` ; reconnus par leur
  connexion Steam (SteamID64 ou format des logs `[U:1:x]`) ;
- pages de test (se rechargent sur chaque `veto:updated` du WebSocket) : `/veto/:matchId` (capitaines et spectateurs :
  seulement ses propres coups, même pour un admin) et `/veto/:matchId/admin` (admin : qui commence, étape jouée à la
  place d'une équipe nommée, annuler, recommencer) ; actions
  `POST /veto/:matchId/rps { choice }`, `start { first }` (gagnant du PFC) ou `{ teamId }` (admin : PFC joué
  ailleurs), `step { map }` ou `{ side }`, `undo` / `reset` (admin) - JSON, ou formulaires de la page (`_form=1`, redirection) ;
  état JSON : `GET /api/tournament/matches/:id/veto` (le choix PFC de la manche en cours n'est jamais révélé ;
  `waitingFor` = équipe(s) attendue(s), `lastActionAt` = dernière action) ;
- en direct : chaque action pousse `veto:updated` (état public) dans la room WebSocket du match de la série
  (`io(API, { query: { matchId } })`) ; un capitaine relit alors son état avec sa session ;
- listes : `GET /api/tournament/vetos/mine` (capitaine connecté avec Steam : ses matchs non terminés, `myTurn`) et
  `GET /api/tournament/tournaments/:id/vetos` (vue admin : phase, équipe attendue et depuis quand, faute de minuteur) ;
- séquences (pool de 7) : BO1 6 bans + decider ; BO3 ban ban pick pick ban ban + decider ; BO5 ban ban pick ×4 + decider ;
- grande finale (finaliste du haut avec une map d'avance) : même véto, la map restante à la fin est la map d'avance,
  non jouée (déjà comptée par `advantageHome` / `advantageAway`) : seules les maps pickées deviennent des games ;
- pas de minuteur (décidé avec l'utilisateur) : un admin joue l'étape d'un capitaine absent ; chaque étape garde son auteur
  (`acted_by`) et son heure ; à la fin, les maps deviennent les games de la série (`MatchMap`), le serveur est choisi au
  lancement ; un game prévu mais non joué (BO3 gagné 2-0) passe en `CANCELLED` ;
- démo à essayer : `make veto-demo` (BO3, ton SteamID admin capitaine de Démo Rouge), puis `make veto-bot` : adversaire
  automatique capitaine de Démo Noir (vraies routes de capitaine, session joueur signée avec le `JWT_SECRET` de dév),
  qui joue dès que c'est son tour et affiche chaque `veto:updated` reçu.

**Design des pages** - le style vit uniquement dans le CSS, jamais dans les pages :
- squelette commun `htmlPage({ title, body, theme })` (`application/shared/html-page.ts`) : barre du site, thème sombre ;
- `backend/public/css/` servi sous `/assets/css` (sans cache : une modification se voit en rafraîchissant) :
  `base.css` (palette gglan.fr rouge sur noir, police Poppins, variables Pico surchargées, **vocabulaire de classes**
  autorisé dans les pages), puis `admin.css` (Sandbox, opérations : dense) ou `public.css` (joueurs, spectateurs) ;
- socle Pico.css classless et Poppins (`@fontsource/poppins`) servis depuis `node_modules`, sans CDN (LAN-first) ;
- CSS standard (variables, imbrication natives), pas de SCSS ni de Tailwind : pas d'étape de compilation, et le style
  ne doit pas être écrit dans le HTML ;
- la page `/sandbox` garde sa mise en page intégrée, mais ses couleurs et sa police sont les variables `--gg-*` de
  `base.css` : elle suit toute modification ;
- principes : le rouge signale seulement ce qu'on peut faire maintenant (boutons d'action, « à toi de jouer »,
  focus), CT / T aux couleurs du jeu, casse normale (pas de majuscules forcées), pas d'emojis, de flèches ni de
  chaînes à points médians ; boutons `secondary` (autre action) et `danger` (destructif).

CORS REST : origines autorisées via `CORS_ORIGIN` (liste séparée par des virgules, défaut `http://localhost:3000`).

#### WebSocket (`adapters/ws/`)
- `match.gateway.ts` - Socket.IO (`/socket.io`), rooms `match:{id}:public` et `match:{id}:admin`. Rôle : jeton JWT du handshake (scripts) ou, à défaut, **cookie de session** (le front React, même origine). Match : `?matchId=` à la connexion (pages de véto) et/ou `match:subscribe { matchId }` / `match:unsubscribe` ensuite ; une connexion sans match est acceptée et ne reçoit rien tant qu'elle ne s'abonne pas
- `broadcaster.service.ts` - Subscribe `ggbot:events`, mappe vers `InternalEvent`, broadcast WS
- `socket.auth.guard.ts` - Guard JWT (role: admin/viewer)
- `dto/events.dto.ts` - `WsEventType` + tous les types WS typés
- Événements admin d'arbitrage : `match:review_required` (Game Over serveur ≠ GG-Core), `match:review_resolved`. Les comptes à rebours (`phase:countdown` / `phase:cancelled`) sont mappés dans les deux graphies (`:` et `_`)

#### Redis (`adapters/redis/`)
- Tokens d'injection : `REDIS_CMD`, `REDIS_PUB`, `REDIS_SUB`
- 3 clients distincts (commandes/lecture, publication, souscription)

#### Database (`adapters/database/`)
- `PrismaService` - Client Prisma connecté à PostgreSQL (gestion cycle de vie NestJS `onModuleInit`/`onModuleDestroy`)
- `DatabaseModule` - Module global exportant `PrismaService` et `TournamentPersistenceService`
- Modèles Prisma : `Tournament`, `Team`, `Player`, `TeamRoster`, `Server`, `Match`, `MatchVeto`, `MatchMap`, `PlayerMapStats`, `EventPrimary`

**Liaison moteur temps réel ↔ modèle relationnel**
- Les matchs temps réel ont des identifiants libres (`m-7ef15f093f`, `m-sandbox-1`) ; les tables relationnelles utilisent des **UUID**.
- `POST /api/matches/:id/init` avec `matchMapId` (UUID d'un `MatchMap`) pose `match:{id}:db_match_map`. À défaut, un matchId qui est lui-même l'UUID d'un `MatchMap` est accepté.
- `DatabaseEventsHandler` (asynchrone, non bloquant) :
  - écrit **toujours** l'événement dans `events_primary` avec `match_id` / `server_id`, et `match_map_id` seulement si la liaison est résolue (cache 30 s) ;
  - n'écrit les `PlayerMapStats` que si le `MatchMap` **et** l'UUID d'équipe (`teams.home_id/away_id`, via côté CT/T → home/away) sont connus.
- Fin de match : le résultat du game est écrit (`recordGameResult`, source `AUTOMATIC`), puis la série est recalculée (`updateSeries`) : BO1 / BO3 / BO5 avancent l'arbre par le même chemin qu'une saisie admin. Sans game lié, un matchId qui est l'UUID d'un `Match` fait avancer ce match directement.
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
- **Ces deux clés sont distinctes** - ne pas confondre
