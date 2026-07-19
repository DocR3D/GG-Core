# eBot-CSGO — Référence architecture (projet d'origine)

> GG-Core (eBot++) est une réécriture inspirée de **eBot-CSGO** (deStrO). Ce document résume son
> fonctionnement — en particulier la relation serveur CS ↔ eBot — comme référence de conception,
> pas comme documentation de GG-Core lui-même (voir `docs/context/*.md` et `CLAUDE.md` pour ça).
>
> Sources : [github.com/deStrO/eBot-CSGO](https://github.com/deStrO/eBot-CSGO) et
> [deepwiki.com/deStrO/eBot-CSGO](https://deepwiki.com/deStrO/eBot-CSGO) (consultées le 2026-07-19).
> Certains détails bas niveau (voir section "Zones d'ombre") n'étaient pas couverts par ces sources
> et mériteraient une lecture directe du code source avant toute décision de conception qui en dépendrait.

---

## Vue d'ensemble — architecture à 3 niveaux

eBot-CSGO est un système hybride **PHP + Node.js + MySQL + Redis** :

1. **Couche serveur de jeu** — le serveur CS:GO/CS2 émet des logs bruts en UDP et reçoit des commandes RCON
2. **Couche logique (PHP)** — l'`Application` core lit les logs, les parse, gère la state machine `Match`, persiste en MySQL
3. **Couche diffusion temps réel (Node.js)** — un serveur WebSocket (Socket.io) fait le pont entre le core PHP et les clients web, via un bus Redis Pub/Sub

```
CS:GO/CS2 Server
    │  UDP logs (logaddress)          ▲  RCON (TCP, Source RCON Protocol)
    ▼                                  │
Redis  (liste REDIS_CHANNEL_LOG) ──LPOP──▶  PHP Core (Application::run())
                                             │
                                             ├─▶ MySQL (persistance match/joueurs/rounds)
                                             └─▶ Redis (REDIS_CHANNEL_EBOT_TO_WS) ──▶ Node.js WS ──▶ clients web (Socket.io)
                                                                                        ▲
                                             ◀── Redis (REDIS_CHANNEL_EBOT_FROM_WS) ────┘  (commandes admin depuis le web)
```

---

## La relation serveur CS ↔ eBot (le cœur du sujet)

### Sens serveur → eBot : logs via UDP, mis en file dans Redis

- Le serveur CS:GO/CS2 est configuré pour streamer ses logs vers eBot (mécanisme UDP `logaddress`,
  l'équivalent historique du `logaddress_add_http` utilisé aujourd'hui par CS2 — eBot date d'avant l'API HTTP).
- Les lignes de log brutes atterrissent dans une **liste Redis** (`REDIS_CHANNEL_LOG`), consommée par
  dépilement (`LPOP`) — Redis sert ici de **file d'attente**, pas de pub/sub, pour ce flux précis.
- La boucle principale `Application::run()` (PHP) dépile en continu, parse chaque ligne, et met à jour
  l'état du match en mémoire + MySQL.
- Le fichier `config.ini` définit `BOT_IP`/`BOT_PORT` (rôle exact — réception UDP directe vs relais vers
  Redis — non confirmé par la documentation disponible, à vérifier dans le code si besoin).

### Sens eBot → serveur : RCON (Source RCON Protocol)

- Une classe `Rcon` abstraite gère l'IP/port/mot de passe et s'authentifie automatiquement à l'instanciation
  (`MatchException` si l'auth échoue). La sous-classe `CSGO` implémente le **protocole RCON Source** de Valve
  par-dessus un socket TCP (`fsockopen`).
- Format binaire : entiers little-endian 32 bits pour l'entête, chaînes null-terminated pour le corps.
  Types de paquet : `SERVERDATA_AUTH` (3), `SERVERDATA_EXECCOMMAND` (2), `SERVERDATA_RESPONSE_VALUE` (0).
- Séquence d'envoi : `pack('V', $size)` pour construire le paquet → écriture socket → lecture des 4 octets
  de taille de la réponse → lecture du payload → unpack.
- Commandes typiques envoyées : cvars `mp_*` (round time, freeze time, règles de match), `changelevel <map>`,
  `say`/`say_team` (messages aux joueurs), `mp_backup_restore_load_file` (restauration de backup de round —
  utile pour un crash serveur ou un round à rejouer).
- Gestion d'erreur : échec réseau → `SocketException`, loggué sans crasher le process ; `MatchManager`
  désactive le match concerné en cas d'échec d'authentification RCON.

> **Point clé pour GG-Core** : eBot n'a **pas** de plugin SourceMod côté serveur — tout passe par
> logs UDP (entrant) + RCON (sortant), exactement le choix de conception que GG-Core reprend (voir
> cahier des charges : "Sans plugin SourceMod (RCON + logaddress_add_http uniquement)").

---

## Configuration exécutée par phase de match (knife / warmup / live)

Vérifié directement dans le code source (`src/eBot/Match/Match.php`, classe `Match`, méthodes privées).
Contrairement à GG-Core, **eBot n'exécute quasiment jamais de vrai fichier `.cfg`** : la plupart des
transitions de phase envoient des **cvars RCON en ligne**, construites comme de simples chaînes de
caractères. Un seul vrai fichier `.cfg` est exécuté pour le ruleset de match.

| Méthode | Appelée quand | Effet réel (RCON) |
|---|---|---|
| `executeKnifeConfig()` | Juste avant le knife round, via la chaîne `undoWarmupConfig()->executeMatchConfig()->executeKnifeConfig()->goLive("KNIFE")` | Cvars inline : `mp_halftime_duration 1`, `mp_roundtime 60`, `mp_roundtime_defuse 60`, `mp_roundtime_hostage 60`, secondaires CT/T vidées (`''`), `mp_free_armor 1`, `mp_give_player_c4 0`, `mp_maxmoney 0` |
| `undoKnifeConfig()` | À la sortie du knife round | Restaure les cvars normaux : `mp_halftime_duration 15`, `mp_roundtime 5`, secondaires par défaut (`weapon_hkp2000`/`weapon_glock`), `mp_free_armor 0`, `mp_give_player_c4 1`, `mp_maxmoney 16000` |
| `executeWarmupConfig()` | Entrée en warmup | `mp_warmuptime 3600` (quasi infini), `mp_warmup_pausetimer 1`, argent à `60000`, `mp_free_armor 1`, `mp_warmup_start` |
| `undoWarmupConfig()` | Sortie du warmup | `mp_warmuptime 30`, `mp_warmup_pausetimer 0`, argent remis à `800`/`16000` (start/max), `mp_free_armor 0`, `mp_warmup_end` |
| `executeMatchConfig()` | Une fois avant le live (knife ou direct) | **Seul vrai `exec` de fichier** : `exec {matchData["rules"]}.cfg` — le nom du fichier vient du champ `rules` du match (type de ruleset/format de queue, ex. un preset "5v5"/"wingman"/etc. propre à l'installation), suivi de `mp_warmuptime 0`, `mp_halftime_pausetimer 1`, `mp_maxrounds = maxRound*2` |

Pas de méthode `undoMatchConfig()` symétrique : à l'arrêt admin du match (`adminStop()`/`adminStopNoRs()`),
eBot fait simplement `exec server.cfg` (retour aux réglages par défaut du serveur) + reset des noms/flags
d'équipe. `exec server.cfg` est aussi utilisé après l'arrêt d'un enregistrement de demo.

**Overtime** : pas de méthode `executeOvertimeConfig()` dédiée — les cvars `mp_overtime_enable 1`,
`mp_overtime_maxrounds`, `mp_overtime_startmoney`, `mp_overtime_halftime_pausetimer 1` sont envoyées
en ligne, directement dans le code de transition de phase (pas encapsulées, pas d'undo).

**Pause** : `pauseMatch()`/`unpauseMatch()` envoient juste `mp_pause_match` ou `pause`/`unpause` selon
la valeur de `PAUSE_METHOD` (`instantConfirm` / `instantNoConfirm` / `nextRound`) — pas de fichier `.cfg` non plus.

---

## Pipeline de parsing des logs

- **`MessageManager`** est l'orchestrateur central. Au bootstrap, il lit `config/messages.ini` pour savoir
  quels parsers de message activer.
- Pipeline "Match and Process" : chaque ligne de log brute est testée contre une collection de parsers,
  chacun portant une regex ; le premier qui matche traite la ligne.
- Deux namespaces séparent les responsabilités :
  - `eBot\Message\CSGO` — logique de parsing + définitions des regex (une classe abstraite `Message` porte
    la regex et la méthode `match()` ; les classes concrètes comme `Kill` définissent leur regex et leur `process()`)
  - `eBot\Message\Type` — objets de données simples (POPO) qui portent les données extraites
- Une fois un objet `Type` instancié, il est transmis à la classe `Match`, qui met à jour l'état de jeu et
  les statistiques en conséquence.

### Catalogue des types de messages reconnus (non exhaustif selon la doc)

| Catégorie | Types | Détail |
|---|---|---|
| Combat | `Kill` | Tueur/victime, position, arme, headshot |
| Combat | `Attacked` | Dégâts entre joueurs, hitgroup — sert aux heatmaps |
| Round | `RoundStart` | Déclenché par `"World triggered 'Round_Start'"` |
| Round | `RoundSpawn` | Event interne eBot (`"eBot triggered 'Round_Spawn'"`), synchronisation |
| Round | `RoundScored` / `RemindRoundScored` | Détermine le vainqueur du round (bombe explosée, élimination, sauvé, désamorcée) |
| Round | `TeamScored` | Mise à jour périodique du score par équipe |
| Chat | `Say` / `SayTeam` | Chat global/équipe — support des commandes `!ready`, `!pause`, etc. |
| Économie | `Purchased` | Achats d'équipement |
| Connexion | `Connected`, `Disconnected`, `EnteredTheGame`, `ChangeName`, `ChangeMap` | Cycle de vie joueur/serveur |
| Bombe | `BombPlanting`, `BombDefusing` | |

---

## Commandes chat joueur (en jeu)

Vérifié dans `Match::processSay()` (`src/eBot/Match/Match.php`) — dispatch sur `!commande` ou `.commande`
(`isCommand()` compare le texte exact, insensible au préfixe `!`/`.`). Tout message qui ne matche aucune
commande déclenche un event `Say` générique (hook pour les plugins).

| Commande | Contexte requis | Effet |
|---|---|---|
| `!map <mapname>` | Warmup, veto non engagé, map dans le pool configuré (`Config::getMaps()`) | Chaque équipe propose une map (`playMap['ct']`/`['t']`) |
| `!stats` | Toujours | Affiche (en privé) K/D/HS% du joueur |
| `!morestats` | Toujours | Stats détaillées : clutchs 1vX, kills/round, bombe posée, défuse, TK, first kill |
| `!rules` | Toujours (si plugin csay actif) | Affiche full score / switch auto / overtime / maxround du match |
| `!help` | Toujours | Liste les commandes disponibles (varie si les timeouts sont activés) |
| `!ready` | Warmup, map engagée | Équipe se déclare prête → `startMatch()` dès que CT+T sont prêts (bloqué si un streamer n'est pas prêt, cf. `config_streamer`) |
| `!notready` / `!unready` | Warmup, map engagée | Annule l'état "prêt" de l'équipe |
| `!abort` | Countdown de ready en cours | Annule le décompte avant le lancement (si `DELAY_READY` activé) |
| `!restart` | Knife round (`STATUS_KNIFE`/`STATUS_END_KNIFE`) | Chaque équipe vote ; si CT+T d'accord → relance le knife round depuis `STATUS_WU_KNIFE` |
| `!stay` | Fin de knife (`STATUS_END_KNIFE`), équipe gagnante uniquement | Garde les côtés, passe en warmup 1ère side (`undoKnifeConfig()->executeMatchConfig()->executeWarmupConfig()`) |
| `!switch` / `!swap` | Fin de knife, équipe gagnante uniquement | Échange les côtés (`mp_swapteams`), même chaîne de config que `!stay` |
| `!pause` | En match, si `TIMEOUT_ENABLED=false` | Demande de pause — comportement selon `PAUSE_METHOD` (`instantConfirm`/`instantNoConfirm`/`nextRound`) ; si les timeouts sont activés, `!pause` redirige vers `!tech`/`!timeout` |
| `!tech` | En match | Pause technique (équivalent `!pause` quand les timeouts sont activés) |
| `!unpause` | Match en pause | Chaque équipe confirme ; débloque via `unpauseMatch()` |
| `!timeout` / `!tac` | En match | Timeout tactique — RCON `timeout_ct_start`/`timeout_terrorist_start` |
| `!continue` | En match, actuellement désactivé (`!enable`) | Chaque équipe vote pour reprendre après un stop |
| `!stop` | En match, si non désactivé (`COMMAND_STOP_DISABLED`) | Chaque équipe vote → arrête le match (`stopMatch()`) |
| `!status` | Toujours | Affiche l'état courant du match (et s'il est en pause) |
| `!status2` | Toujours | Affiche le score — marqué `// DUPLICATE - REMOVE? TODO` dans le code source lui-même |
| `!fixwarmup` | Coincé en `STATUS_WU_1_SIDE`/`STATUS_WU_KNIFE` | Ré-exécute `executeWarmupConfig()` manuellement (garde-fou, une seule fois) |
| `!connect` | Toujours | Renvoie en privé la chaîne `connect <ip>; password <pwd>;` |
| `!version` | Toujours | Non implémenté (`// NYI - TODO`) |
| `!debug` | Toujours | Affiche l'état interne brut (`// NOT FINISHED - TODO`) |

**Correspondance avec GG-Core** : `!ready`/`!unready`, `!pause`/`!tac`/`!tech`/`!unpause`, `!stay`/`!switch`
existent déjà côté GG-Core (voir `backend.md` → Commandes chat) avec la même sémantique. eBot a en plus
`!restart` (revote du knife), `!stop`/`!continue` (arrêt/reprise votée), `!timeout` séparé de `!pause`,
`!map` (veto en jeu), et plusieurs commandes info/debug (`!stats`, `!rules`, `!status`, `!connect`, ...)
qui n'ont pas d'équivalent GG-Core actuellement.

---

## Bus interne & diffusion temps réel (au-delà du lien serveur CS ↔ eBot)

Trois channels Redis structurent la communication PHP ↔ Node.js :

| Channel | Source → Destination | Rôle |
|---|---|---|
| `REDIS_CHANNEL_LOG` | Serveur de jeu → PHP Core | Logs bruts (file, consommée par `LPOP`) |
| `REDIS_CHANNEL_EBOT_TO_WS` | PHP Core → Node.js | Mises à jour de match (scores, kills, changement de map) |
| `REDIS_CHANNEL_EBOT_FROM_WS` | Node.js → PHP Core | Commandes admin (stop, exécution RCON) |

Le serveur Node.js organise les clients WebSocket (Socket.io) en **rooms** :

| Room | Contenu |
|---|---|
| `matchs` | Scores/statuts globaux — `matchsHandler` |
| `rcon-{id}` | Console RCON admin par match — `rconHandler` |
| `logger-{id}` / `loggersGlobal` | Logs de debug détaillés — `loggerHandler` |
| `livemap-{id}` | Positions joueurs temps réel / heatmap — `livemapHandler` |
| `alive` | Heartbeat entre le core PHP et le serveur WS — `aliveHandler` |

Un client rejoint une room via un message `identify` précisant `type` (et `match_id` si applicable).

### Flux complet : d'une ligne de log au client web
```
Serveur CS  --UDP-->  Redis (LPOP)  -->  PHP Application::run()
   --> parse (MessageManager) --> Match (état + stats) --> MySQL
   --> publish REDIS_CHANNEL_EBOT_TO_WS --> Node.js --> room concernée --> client web (Socket.io)
```

### Flux retour : commande admin web → serveur CS
```
Client web --> (payload chiffré avec l'authkey du match) --> Socket.io
   --> Node.js publish REDIS_CHANNEL_EBOT_FROM_WS --> PHP déchiffre avec l'authkey MySQL du match
   --> Match::adminStop() / adminExecuteCommand() --> RCON --> serveur CS
```

## Sécurité
- **JWT** côté Node.js (`@thream/socketio-jwt`), signé avec `WEBSOCKET_SECRET_KEY`
- **Chiffrement par `authkey`** : chaque match a sa propre clé stockée en MySQL, utilisée pour déchiffrer
  les commandes admin entrantes côté PHP — évite qu'un client web puisse piloter un autre match
- SSL/TLS optionnel des deux côtés (`SSL_ENABLED=true`)

## Persistance MySQL
- Métadonnées et états de match
- Statistiques et profils joueurs
- Historique des rounds et scores
- `authkey` par match (déchiffrement des commandes admin)

## Configuration (`config/config.ini`)

| Section | Contenu |
|---|---|
| `[BDD]` | Identifiants MySQL (`MYSQL_IP`, `MYSQL_USER`, ...) |
| `[Config]` | Identité réseau du bot (`BOT_IP`, `BOT_PORT`), SSL |
| `[Redis]` | Host + noms des 3 channels |
| `[Match]` | Logique de jeu (`LO3_METHOD`, `KO3_METHOD` — méthode de "lineup"/"knife" bo3 —, `TIMEOUT`, ...) |

Démarrage : `php bootstrap.php` (en prod, généralement sous `screen -dmS ebotv3 php bootstrap.php`).
`bootstrap.php` valide l'environnement et lance aussi le serveur WebSocket Node.js si
`NODE_STARTUP_METHOD` n'est pas `none`. Il existe aussi `bootstrap_server.php`/`bootstrap_client.php`
pour un mode "serveur/client" séparé — la répartition exacte des responsabilités entre ces trois fichiers
n'était pas claire dans les sources consultées (voir Zones d'ombre).

Le panneau web (interface admin/joueurs) est un dépôt séparé, **eBot-CSGO-Web**, qui possède sa propre
installation et sa propre base de données.

---

## Zones d'ombre (non confirmées par les sources consultées)
- Rôle exact de `BOT_IP`/`BOT_PORT` : écoute UDP directe des logs, ou uniquement adresse annoncée ailleurs ?
- Composant exact qui reçoit le flux UDP et le pousse dans `REDIS_CHANNEL_LOG` (un script séparé ? le process PHP lui-même écoute-t-il un socket UDP ?)
- Répartition précise des responsabilités entre `bootstrap.php`, `bootstrap_server.php`, `bootstrap_client.php`
- Détails de rate-limiting/timing RCON (fréquence d'envoi, gestion de la latence)
- Valeurs possibles exactes du champ `rules` (nom du `.cfg` de ruleset exécuté par `executeMatchConfig()`) —
  vient de la table `matchs` en base, valeurs précises non vérifiées ici

> La section "Configuration exécutée par phase de match" ci-dessus, elle, est vérifiée à 100 % contre le
> code source réel (`Match.php`), pas contre le wiki — le wiki (deepwiki) n'avait pas ce niveau de détail.

Si ces points deviennent importants pour une décision de conception GG-Core, il faut lire le code source
directement plutôt que se fier à ce résumé.

---

## Comparaison rapide avec GG-Core

| Aspect | eBot-CSGO | GG-Core |
|---|---|---|
| Logs entrants | UDP `logaddress` → file Redis (LPOP) | HTTP `logaddress_add_http` → Agent Go → Redis pub/sub + stream |
| Commandes sortantes | RCON direct depuis PHP (`Rcon`/`CSGO` classes) | RCON uniquement depuis l'Agent Go (backend n'a plus d'accès RCON direct depuis la migration 005) |
| Langage cœur métier | PHP (`Application`, `Match`, `MessageManager`) | TypeScript/NestJS (`MatchOrchestrator`, règles de phase, subscribers) |
| Bus interne | Redis pub/sub + liste (3 channels fixes) | Redis pub/sub (`ggbot:events`) + streams (`ggbot:events_primary:*`) + hash/clés d'état |
| Diffusion temps réel | Node.js + Socket.io, rooms par fonction | NestJS Socket.io (`match.gateway.ts`), rooms `match:{id}:public`/`admin` |
| Persistance long terme | MySQL | PostgreSQL |
| Sécurité commandes admin | `authkey` chiffré par match | JWT (rôle admin/viewer) + `agent_token` par serveur |
| Plugin serveur CS | Aucun (RCON + logs uniquement) | Aucun (même choix, RCON + `logaddress_add_http`) |
| Fichiers `.cfg` vs cvars inline | Cvars envoyées en ligne pour knife/warmup/pause/overtime (pas de fichier) ; un seul vrai fichier exec'd pour le ruleset (`{rules}.cfg`) ; `server.cfg` pour reset | Fichiers `.cfg` dédiés par phase (`knife.cfg`, `warmup.cfg`, `competitive.cfg`, `overtime.cfg`, `init.cfg`), exécutés par l'agent Go (voir `agent-go.md`) |
| Gestion multi-serveurs | Une instance par serveur a priori (à vérifier) | Table `Server` PostgreSQL + probe de statut + un agent Go par serveur (voir `docs/context/infra.md`) |

Cette comparaison sert de point de départ ; à affiner au fil des sessions si des choix de conception
spécifiques d'eBot doivent être étudiés plus en profondeur (ex. gestion du knife round, calcul d'économie,
mécanisme de backup/reprise après crash serveur).
