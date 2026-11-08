# Architecture GG-Core

##  Vue d’ensemble

Le système est composé de plusieurs services communicants, organisés autour d’un bus temps réel (**Redis**).  
Chaque service a une responsabilité claire : collecte, orchestration, stockage ou diffusion.

---

##  Schéma global

                     ┌─────────────────────┐
                     │     Manager Go      │
                     │   (orchestrateur)   │
                     └─────────┬───────────┘
                               │
        ┌──────────────────────┴───────────────────────┐
        │                                              │
    ┌───────▼───────┐                              ┌───────▼───────┐
    │   Agent Go    │                              │   Agent Go    │
    │  (Server #1)  │                              │  (Server #2)  │
    │  RCON + Logs  │                              │  RCON + Logs  │
    └───────┬───────┘                              └───────┬───────┘
            │                                              │
            └──────────────────┬───────────────────────────┘
                           │  Pub/Sub events
                           ▼
                     ┌──────────────┐
                     │    Redis     │
                     │ (bus temps   │
                     │   réel)      │
                     └───────┬──────┘
                             │
                             ▼
               ┌────────────────────────────┐
               │       Backend NestJS       │
               │   (état + API + WebSocket) │
               └───────────┬────────────────┘
                           │
            ┌──────────────┴─────────────────────────┐
            │                                        │
    ┌───────▼────────────┐                  ┌────────▼────────┐ 
    │    PostgreSQL      │                  │ Frontend React  │
    │ (historique, SOoT) │                  │   (live + admin)│
    │ events_primary/    │                  └─────────────────┘
    │ events_secondary   │
    └────────────────────┘

SOoT = Source of Truth historique (vérité absolue).

---

##  Rôles des composants

###  Agent Go
- Connexion RCON (`pause`, `unpause`, `say`, `restart`, etc.)
- Réception des logs via `logaddress_add_http`
- Publication d’événements dans Redis
- **Prévu** : lecture du flux CSTV/GOTV (positions, grenades, stats avancées) - https://github.com/FlowingSPDG/gotv-plus-go

### ⚙ Backend NestJS
- Consomme les événements Redis
- Gère l’état des matchs/tournois (score, phases, pauses, économie)
- Expose une **API REST** (`/api/...`)
- Diffuse un flux **WebSocket** vers le frontend

###  PostgreSQL (Prisma)
- Base de données relationnelle pour l’historique (vérité absolue) :
  - Tournois, équipes, joueurs, rosters, serveurs
  - Matchs (BO1/BO3/BO5, brackets), vétos, maps, stats joueurs
  - **`events_primary`** : chaque événement de match, indexé par `match_id` (identifiant temps réel) et rattaché à son `match_map_id` quand le match est lié au modèle relationnel (`matchMapId` passé à `POST /api/matches/:id/init`)
  - `events_secondary` (télémétrie) : prévu

###  Redis
- Sert de **bus temps réel** entre les agents et le backend : Pub/Sub `ggbot:events` (le live) et commandes RCON
  `ggbot:agent:<serverId>:actions`. Le front ne parle jamais à Redis : il reçoit le live du backend par WebSocket et
  lit l'historique (PostgreSQL) par l'API.
- L'agent écrit aussi chaque événement dans un **Stream** `ggbot:events_primary:<serverId>` (borné à ~100 000), prévu
  pour rattraper les événements après une coupure. **Personne ne le lit aujourd'hui** : voir « Résilience aux coupures ».

###  Frontend Next.js *(GGCoreFront, dépôt voisin, lancé par `make web` ; le front React + Vite et les pages `/view`, `/veto`, `/sandbox` du backend restent jusqu'à la parité : voir `docs/context/frontend.md`)*
- Application web publique : live scoreboard, overlays, mini‑map
- Console admin pour l’organisation (contrôle des matchs)

---

##  Flux d’information

1. **Logs/RCON** depuis le serveur CS2 → Agent Go  
2. **Agent Go** → Redis (publication d’événements)  
3. **Backend NestJS** → consommation Redis + mise à jour de l’état en mémoire / cache  
4. **Backend NestJS** → WebSocket (push vers frontend)  
5. **Frontend** → rendu live (scoreboard, mini‑map), commandes admin  
6. **Backend** → PostgreSQL (persistance des événements / historique)  

---

##  Flux d'événements : par nature, par destinataire (cible)

Deux séparations distinctes, à ne pas confondre :

**1. Par nature de l'événement : côté Redis et stockage.** Champ `kind` de l'enveloppe (`primary` | `telemetry`, déjà
présent ; le moteur ignore déjà tout ce qui n'est pas `primary`).

| Nature | Source | Canal Redis | Stockage | Usage |
|---|---|---|---|---|
| `primary` (vérité : kills, rounds, bombe, chat, pauses) | Agent Go (logs HTTP de CS2) | `ggbot:events` (+ Stream `ggbot:events_primary:<sid>`) | `events_primary` | Moteur de match, live, stats |
| `telemetry` (positions, grenades, trajectoires) | **Agent CSTV** (V2, se connecte en spectateur au flux CSTV/GOTV ; section `cstv` déjà dans la config de l'agent) | Canal séparé, ex. `ggbot:telemetry:<sid>` : son débit (plusieurs messages par seconde et par joueur) ne doit pas ralentir le moteur | `events_secondary` (cahier des charges), échantillonnable | **Replay 2D disponible en fin de partie** |

Les positions servent un replay **après** la partie, pas un affichage en direct : pas de flux de positions vers les
écrans pendant le match, donc pas de question de délai (ghosting) pour l'instant. Si un jour on affiche des positions en
direct, il faudra les retarder de `tv_delay` partout où un joueur peut voir l'écran.

**2. Par destinataire : côté backend, au moment de pousser par WebSocket.** Redis transporte chaque événement une fois ;
le backend décide qui le reçoit (`Audience` de `domain/events/internal-events.ts`, une room Socket.IO par match et par
audience).

| Audience | Room | Qui | État |
|---|---|---|---|
| `public` | `match:{id}:public` | Tout le monde : spectateurs, écrans de la LAN | Fait |
| `admin` | `match:{id}:admin` | Admins (chat, commandes, actions des agents, arbitrage) | Fait |
| `team` | `match:{id}:team:{teamId}` | Les joueurs d'une équipe (« ton match est prêt », serveur, véto à jouer) | À faire (portail joueur) |
| `overlay` | `match:{id}:overlay` ou par serveur | Pages OBS (score, prochain match, MVP) : données publiques, mises en forme pour l'écran du stream | À faire (§13 du todo) |

Ajouter une audience = une valeur d'`Audience`, une room et la règle « qui la rejoint » dans `match.gateway.ts` ; Redis
ne change pas.

---

##  Résilience aux coupures (intention, pas encore faite)

**But** (dit par l'utilisateur) : ne pas perdre d'événements de match si un agent Go est coupé du réseau un moment, ou
si GG-Core (backend) est coupé ou redémarre. Pub/Sub ne garde rien : un message publié quand personne n'écoute est
perdu. Aujourd'hui, un événement émis pendant une coupure manque au live ET à PostgreSQL (`events_primary`). Les
scores ne se décalent pas pour autant : le `Game Over` du serveur est comparé au score de GG-Core (gel + arbitrage admin).

| Coupure | Couvert par le Stream ? | Ce qu'il faut |
|---|---|---|
| Backend arrêté / redémarré, ou coupé de Redis, l'agent joint Redis | Oui, si le backend le lit | Backend : lire le Stream avec un consumer group (`XREADGROUP`, `XACK` après traitement) **à la place** du Pub/Sub pour les événements de match (les deux = événements traités deux fois). Au redémarrage, le groupe reprend où il s'était arrêté. |
| Agent coupé du réseau (Redis est sur la machine centrale) | **Non** : le Stream est dans Redis, l'agent ne peut pas l'écrire | Agent : garder les lots non envoyés (mémoire ou disque, borné) et les renvoyer dans l'ordre au retour du réseau. Aujourd'hui `flush()` (`agent/cmd/agent/main.go`) journalise l'erreur et **jette le lot**. |

À régler en même temps :
- **matchId des événements** : l'agent lit `ggbot:server:<sid>:currentMatch` alors que le backend écrit
  `server:<sid>:currentMatch` (`redis.keys.ts`). L'agent envoie donc toujours `matchId: "unknown"` et le backend
  retrouve le match par le `serverId` à la réception. Pour un rattrapage, ce rattachement doit se faire au moment de
  l'événement (sinon des événements rejoués après un changement de match iraient au nouveau match).
- Rejouer des événements anciens doit rester sans effet de bord sur le serveur (pas de RCON déclenché en retard).

Historique : un consommateur `PrimaryConsumer` (`backend/src/adapters/streams/`, `XREADGROUP` + `XACK`) existait
depuis septembre 2025 (`091baa9`) mais n'a jamais été branché (module importé nulle part). Retiré le 2026-11-01
(branche `chore/backend-lint`) comme code mort ; on le retrouve avec `git show f6fbfcb^:backend/src/adapters/streams/primary-stream.consumer.ts`.

---

##  Contraintes & Rappels

- Côté serveurs CS2, seules les commandes suivantes sont nécessaires :  
  `rcon_password 123456` et `logaddress_add_http "http://<AGENT_HOST>:8082/logs?token=<token>"` (vers l’**agent** du serveur, pas le backend : `/cs2/logs` attend du JSON déjà parsé)
- **PostgreSQL `events_*` = vérité absolue**. Redis est éphémère/temps réel.
- Manager Go crée 1 **agent** par serveur CS2 et les supervise.
