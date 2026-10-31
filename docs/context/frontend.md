# Frontend - Contexte

## État actuel
**Mis en place** (`frontend/`) : React + Vite, Tailwind avec la charte, React Router, client Socket.IO ; barre du site
(session via `/auth/me`, état du lien en direct) et une première page (liste des tournois). Les écrans (console admin,
scoreboard, véto, portail joueur) restent à faire.

- **Développement** (Windows ou Linux, Node installé) : `cd frontend && npm install && npm run dev` → http://localhost:5173,
  rechargement instantané ; les appels `/api`, `/auth`, `/login`, `/view`, `/veto`, `/sandbox`, `/assets`, `/socket.io`
  partent vers le backend (`GG_BACKEND`, défaut http://localhost:8081, stack lancée par `make up`). Le cookie de
  session de `localhost:8081` vaut aussi pour `localhost:5173` (les cookies ignorent le port).
- **Servi par le backend** : `make front` compile dans un conteneur Node (aucune installation) vers `frontend/dist` ;
  `make up` le refait seulement si une source a changé. Le backend (`FRONT_DIST`, `/front` en Docker) sert
  `/static/*` (noms hachés, cache long) et renvoie `index.html` pour toute page qui n'est pas une route serveur
  (`/api`, `/auth`, `/login`, `/view`, `/veto`, `/sandbox`, `/assets`, `/cs2`, `/socket.io`) : React Router affiche
  l'écran. Sans build, le backend le signale au démarrage et ses pages continuent de marcher.
- Fichiers de Vite sous `/static` (et non `/assets`, déjà pris par le CSS et les polices des pages serveur).

Les pages serveur restent en attendant d'être remplacées : le backend sert des pages HTML simples, sans JS (sauf rechargement sur `veto:updated`) : `/view`
(tournois, arbres, matchs), `/veto/:matchId` (+ `/admin`), `/login`, et les outils de dev `/sandbox` et
`/sandbox/tournament`. Leur style vit dans `backend/public/css/` (voir « Design des pages » dans
`docs/context/backend.md`). Toutes les données passent par l'API REST : un futur front pourra s'y brancher tel quel.

## Stack retenue (décidée avec l'utilisateur le 2026-10-31)
- **React + Vite** (TypeScript), routage côté navigateur (React Router) : aucun rechargement de page (exigence du
  cahier des charges, maintenue).
- **Servi par NestJS** : `npm run build` produit des fichiers statiques que le backend distribue sur son port (8081).
  En développement, le serveur Vite recharge l'écran instantanément et renvoie `/api`, `/auth` et `/ws` au backend.
- **Socket.IO client** pour le temps réel ; **Tailwind CSS** ; **shadcn/ui** restylé (voir Design).
- Responsive : PC, tablette, TV.

### Pourquoi pas Next.js (prévu par le cahier des charges)
Next.js apporte surtout le rendu côté serveur (référencement, premier affichage d'un site public) et ses propres
routes serveur : rien dont une LAN a besoin. Il coûterait un deuxième serveur Node à lancer, surveiller et publier par
le tunnel, et deux origines (ports 3000 / 8081), donc du CORS et des cookies de session à faire passer. Servi par
NestJS, le front a la même adresse que l'API : la connexion (Steam, mot de passe admin) marche telle quelle.

### Design
- **Tailwind** avec la charte de `backend/public/css/base.css` comme seule palette (les couleurs par défaut de
  Tailwind sont retirées) : fond `#1d1f24`, surface `#262930`, texte `#dde3ed`, rouge `#de1b1b` réservé aux actions,
  CT `#6f9fe6`, T `#e3a23f` ; Poppins, police à chasse fixe pour les scores et tableaux (chiffres alignés).
- **shadcn/ui** pour ses fondations Radix (boîtes de dialogue, menus, notifications, onglets : clavier, focus,
  accessibilité), en copiant seulement les composants utiles et en **réécrivant leur style** : jamais l'apparence par
  défaut (palette zinc, cartes arrondies identiques, ombres douces), qui donnerait un tableau de bord générique.
- Règles reprises des pages actuelles : le rouge signale seulement ce qu'on peut faire maintenant ; CT / T aux couleurs
  du jeu ; casse normale ; la structure (bordures, couleurs d'état) porte une information (serveur occupé, match en
  direct, alerte), pas une décoration ; un seul élément marquant : l'arbre du tournoi et le scoreboard aux chiffres
  alignés, dans l'esprit des vues ASCII actuelles.

## Connexion au backend
- Même origine que le backend (le front est servi par NestJS) : REST `/api/...`, Socket.IO `/ws`
- Auth : la session existante (cookie `gg_session` posé par `/login`), aucun jeton à gérer côté front
- Rooms : `match:{id}:public` (tous) et `match:{id}:admin` (admins)

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
