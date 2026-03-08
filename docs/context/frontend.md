# Frontend — Contexte

## État actuel
**Non implémenté.** Aucun dossier `frontend/` n'existe dans le projet.

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
- `match:state` — snapshot complet (score, sides, teams, pause, économie)
- `score:update` — mise à jour score
- `round:start` / `round:end`
- `phase:changed` / `phase:countdown` / `phase:cancelled`
- `sides:swapped`

### Combat
- `kill` — kill avec payload KillPayload (player/suicide/world)
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
GET  /health
GET  /api/matches/:id/snapshot
GET  /api/matches/:id/score-with-teams
GET  /api/matches/:id/players
GET  /api/matches/:id/economy
GET  /api/matches/:id/sides
PUT  /api/matches/:id/sides
POST /api/matches/init
PATCH /api/matches/:id/teams
```
