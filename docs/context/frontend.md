# Frontend - Contexte

## État actuel
**Non implémenté.** Aucun dossier `frontend/` n'existe dans le projet.

En attendant, le backend sert des pages HTML simples, sans JS (sauf rechargement sur `veto:updated`) : `/view`
(tournois, arbres, matchs), `/veto/:matchId` (+ `/admin`), `/login`, et les outils de dev `/sandbox` et
`/sandbox/tournament`. Leur style vit dans `backend/public/css/` (voir « Design des pages » dans
`docs/context/backend.md`). Toutes les données passent par l'API REST : un futur front pourra s'y brancher tel quel.

## Stack prévue (selon cahier des charges)
- **Next.js** (React)
- **Socket.IO client** pour WebSocket temps réel
- Responsive : PC, tablette, TV

## Connexion au backend
- WebSocket sur `ws://backend:8081/ws` (namespace Socket.IO)
- Auth : JWT token en query param à la connexion
- Rooms : `match:{id}:public` (tous) et `match:{id}:admin` (admins)
- REST API : `http://backend:8081/api/`

## Événements WebSocket disponibles (voir `backend/src/adapters/ws/dto/events.dto.ts`)

### Match
- `match:state` - snapshot complet (score, sides, teams, pause, économie)
- `score:update` - mise à jour score
- `round:start` / `round:end`
- `phase:changed` / `phase:countdown` / `phase:cancelled`
- `sides:swapped`

### Combat
- `kill` - kill avec payload KillPayload (player/suicide/world)
- `team_round_win`
- `bomb:planted` / `bomb:begin` / `defuse:begin` / `defuse:abort`
- `grenade_throw` / `player_blinded`

### Pause
- `pause:update`

### Joueurs
- `player:connected` / `player:disconnected` / `player:name_change`
- `item:purchase`

### Chat / Admin
- `chat:public` / `chat:admin`
- `command` (admin uniquement)
- `agent:action` / `agent:result` / `log:raw` (admin uniquement)

### Divers
- `knife:result`
- `sponsor:rotate`

### Accès au serveur (admin uniquement)
- `access:not_allowed` : un joueur absent de la whitelist du match s'est connecté (`player`, `kicked` : kické ou non).

### Camps (admin uniquement, sides choisis au véto)
- `sides:misplaced` : des joueurs ne sont pas dans le camp de leur équipe, le live attend (`expected`, `misplaced`).
- `sides:unchecked` : contrôle impossible (`reason` : roster sans SteamID, équipe absente des camps), live lancé quand même.

### Véto des maps
- `veto:updated` : état public du véto après chaque action (room du match de la série). Écrans prévus : pierre-feuille-
  ciseaux, puis pick & ban en cliquant sur l'image des maps ; un capitaine trouve ses matchs par
  `GET /api/tournament/vetos/mine` et relit son propre état (`viewer.canAct`) par `GET /api/tournament/matches/:id/veto`.

## Interfaces prévues

### Interface Admin
- Tableau de bord : tournois, matchs, serveurs actifs, statuts
- Console match : commandes directes (pause, restart, swap, changelevel)
- Flux événements temps réel (rounds, kills, chat)
- Gestion entités : équipes, joueurs, serveurs
- Gestion sponsors / messages ingame

### Interface Publique
- Scoreboard live par match
- Stats joueurs (K/D/A, HS%, ADR)
- Timer round + état bombe
- Messages sponsors dynamiques
- Liste matchs tournoi + classements

### Interface Joueur
- Planning personnel (prochain match, heure, serveur, carte)
- Notification match prêt + bouton connexion (applique mdp auto)
- Vérification whitelist SteamID
- Stats personnelles

## Critères UX (cahier des charges)
- Navigation SPA (pas de rechargement)
- Reconnexion automatique WebSocket
- Boutons larges, compatible tablette
- Mode clair/sombre
- Code couleur : vert=actif, orange=pause, rouge=erreur

## API REST à consommer
```
GET   /api/health
GET   /api/matches/:id/snapshot
GET   /api/matches/:id/score-with-teams
GET   /api/matches/:id/players
GET   /api/matches/:id/economy
GET   /api/matches/:id/sides
PATCH /api/matches/:id/sides
PATCH /api/matches/:id/sides/swap
POST  /api/matches/:id/init      (body : sides, teams, serverId, matchMapId, settings…)
POST  /api/matches/:id/start     (init + démarrage serveur)
PATCH /api/matches/:id/teams
```
Liste complète (tournois, poules, arbres, véto, serveurs, opérations admin, connexion) : tableau des endpoints de
`docs/context/backend.md`.

CORS : ajouter l'origine du frontend à `CORS_ORIGIN` côté backend (défaut `http://localhost:3000`).
