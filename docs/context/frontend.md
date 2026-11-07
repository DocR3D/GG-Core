# Frontend - Contexte

## État actuel

### Direction décidée le 2026-11-05 : le front est GGCoreFront (Next.js)
Le front sera le projet **GGCoreFront** (dépôt `sullyvanyonnet/GGCoreFront`, branche `feat/migration-gg-core`, voisin de
ce dépôt : `../GGCoreFront`), pas le `frontend/` React + Vite. Décidé avec l'utilisateur : on garde tout ce qui est fait
du côté de GGCoreFront (sa charte bleu électrique, son dashboard `/admin/dashboard`) et on y ajoute ce que le front Vite
avait en plus. Le plan est dans `docs/plans/migration-frontend-nextjs.md` (partie backend) et dans
`docs/plan-migration-gg-core.md` du dépôt du front. Le front Vite et les pages HTML du backend restent en place jusqu'à
la parité, vérifiée par un tournoi complet joué avec le front Next.

- **Lancer** : `make web` (profil compose `front`, port 3000, IP fixe 172.30.0.20) construit l'image depuis
  `../GGCoreFront` (`FRONT_DIR=<chemin absolu>` pour un autre emplacement), à côté du front Vite (:8081). Le navigateur
  ne parle qu'à Next, qui relaie `/api`, `/auth`, `/socket.io` et `/sandbox` au backend (`BACKEND_URL`, figée à la
  compilation de l'image : changer d'adresse = reconstruire). Même origine : pas de CORS, cookie `gg_session` inchangé.
- **Côté backend** (sur `main`) : login et déconnexion en JSON (`POST /auth/local`, `POST /auth/logout`), routes JSON du
  véto, `GET /api/tournament/matches/:id/connect`, `GET /api/tournament/games/:id/rounds` (les rounds d'un game, publique),
  `/socket.io` public (le garde du gateway authentifie), `TRUST_PROXY`
  (défaut : l'IP fixe du front) pour que la limite d'essais du login voie le vrai client. Retour du login Steam :
  `AUTH_PUBLIC_URL=http://<ip>:3000` dans `.env`.
- **Piège Socket.IO** : engine.io ne répond que sur `/socket.io/` (slash final) et Next retire ce slash en relayant.
  `next.config.ts` a donc `skipTrailingSlashRedirect: true` et deux règles explicites (`/socket.io` et `/socket.io/`
  vers `${backend}/socket.io/`) placées avant la règle générique. Sans elles le live ne marche pas : 404 du polling,
  upgrade WebSocket refusé.
- **Contenu du front** : ses écrans (accueil, dashboard, tournois, matchs, équipes, serveurs) ; les écrans du front Vite
  repris dans `src/legacy/` derrière un routeur maison provisoire (`src/lib/router.tsx`) : console de match, gestion d'un
  tournoi en étapes, sandbox tournoi ; les pages publiques (tournoi avec ses arbres en lecture seule, véto, « Mes vétos »,
  et le match : score de la série, bandeau « En direct », par game la frise des rounds, le tableau des joueurs et, pour
  un game en cours, le scoreboard en direct **sans argent ni équipement** ; la console de match a le même scoreboard
  avec l'argent, et la frise, qui est aussi dans le déplié d'un match de l'écran Matchs) ; **Messages en jeu** (`/admin/messages` : annonce au buytime, messages communautaires) ; **Sandbox match**
  (`/admin/sandbox/match` : presets, injection d'état, replay round par round, scoreboard live, simulateur, RCON,
  console) ; la carte de chaque serveur dit si les logs CS2 arrivent (« reçus il y a N s », « mauvais jeton »).
- **Vérifié** (Chrome headless contre la stack, 2026-11-05) : 20 écrans sans erreur navigateur ni requête en échec ;
  WebSocket connecté sur chaque page ; console de match mise à jour en direct sans rechargement ; créer un tournoi et
  ajouter un serveur dans l'interface ; reconnexion du live après un redémarrage du backend sans recharger la page ;
  **un tournoi monté et déroulé dans l'interface** (renommer, 4 équipes avec
  capitaine, véto enregistré, phase de poules, génération des poules, résultats saisis, arbres Élite et Amateur,
  qualification qui remplit les arbres, véto d'un match d'arbre joué par l'admin jusqu'à `done`, 28 vérifications) ;
  sandbox match (injection, replay dust2 13-0 round par round, simulation) ; typecheck et lint du front sans erreur.
- **Vérifié sur un vrai serveur CS2** (conteneur `make up-cs2`, bots, 2026-11-06) : un match lancé sur le serveur, pause et
  reprise, `say`, forçage de phase (warmup.cfg et knife.cfg bien exécutés), puis un vrai round fini par le temps : le parser
  Go le classe `time`, la route publique des rounds le renvoie et la console l'affiche avec l'horloge (navigateur, sans
  erreur). Les joueurs étaient des bots : le scoreboard avec de vrais joueurs reste à voir.
- **Vérifié avec un joueur humain (2026-11-07)** : login Steam, bouton « Se connecter » de la page du match, véto contre le
  bot, plusieurs rounds et un match jusqu'au Game Over, console (pause, reprise, rejeu d'un round avec pause ensuite, refus
  avec infobulles), coupure du site puis reconnexion sans recharger (la frise, le journal et le scoreboard se relisent à
  la reconnexion). Détail, défauts corrigés et ce qui reste : `docs/rapport-session-test-2026-11-07.md`.
- **Pas encore vérifié** : le suivi en direct d'un game **de tournoi** sur la page publique (serveur CS2 requis ; la même
  frise et le même scoreboard marchent sur la console d'un match de sandbox), le login Steam (Internet requis), le véto joué par de vrais capitaines connectés (deux
  navigateurs, mise à jour en direct de l'autre écran), lancer un game et jouer ses matchs (serveur CS2 requis),
  « Appliquer partout » et les boutons RCON de la sandbox, la correction d'un résultat fini, forfait, format et
  remplacement d'une équipe dans l'interface.
- **Reste** : porter `src/legacy/` en vraies routes Next et retirer le routeur maison ; regrouper par poule les matchs
  de poules de la page publique ; écrans des fonctions déjà dans le backend mais sans interface (sponsors, restauration
  de round, appels admin, alias de commandes et templates) ; puis, après un tournoi complet joué avec ce front, retirer
  `frontend/` (Vite), `make front`, `FRONT_DIST` / `serveFront`, les pages HTML du backend (`/view`, `/veto`, `/login`,
  `/sandbox`) et `backend/public/css`.
- **Fonctions de l'ancien front sans équivalent dans `main`** : forcer la phase d'un match (échauffement, knife,
  prolongation, map suivante) et corriger le score à la main existaient dans l'API de la branche `fix/p0-p1…` de
  sullyvan (`POST /api/matches/:id/admin-actions` vers un handler `/admin-action` de l'agent Go), jamais fusionnée.
  Son agent n'appliquait d'ailleurs pas le score (« non applicable sans plugin CS2 ») : il exécutait seulement un
  fichier de config. L'historique public d'un match (événements) demande une route filtrée (le journal complet est
  réservé aux admins : il contient le chat, les logs bruts et les actions admin).
- **Vérifier dans un navigateur** : `tools/front-check/` (Chrome headless piloté par le protocole DevTools, sans
  dépendance) : parcours des écrans, flux joués, page Sandbox ; voir son README.

### Front React + Vite (`frontend/`), transitoire jusqu'à la parité
**Mis en place** (`frontend/`) : React + Vite, Tailwind avec la charte, React Router, client Socket.IO ; barre du site
(session via `/auth/me`, état du lien en direct) et une première page (liste des tournois). Les écrans (console admin,
scoreboard, véto, portail joueur) restent à faire.

**Tableau de bord admin** (`/admin`, admins seulement) : games en cours (serveur, équipes avec leur camp et leur score
en chiffres alignés, map, tournoi, phase, pause en ambre, « Résultat à arbitrer » en rouge), serveurs (disponibilité,
agent, RCON, logs reçus, mauvais jeton), tournois. Rafraîchi toutes les 5 s (`usePolling`), jamais rechargé.
**Gestion d'un tournoi** (`/admin/tournaments/:id/<étape>`), en étapes qui ont chacune leur adresse (décidé avec
l'utilisateur : une seule page ne disait pas quoi faire quand). Une barre d'étapes indique ce qui est fait ou ce qui
manque ; ouvrir un tournoi mène à la première étape pas faite ; chaque étape finit par « Étape suivante ».
1. **Tournoi** : nom, statut.
2. **Équipes** : équipes et joueurs (SteamID, capitaine) ; faite à partir de 2 équipes, signale les joueurs sans SteamID.
3. **Véto** : pool de maps et mode de side ; faite une fois le pool enregistré.
4. **Phases** : créer les phases une par une dans leur ordre (« Créer les arbres Élite et Amateur » en un clic après
   des poules ; un formulaire « tout en une fois » a été essayé puis retiré, jugé trop complexe par l'utilisateur),
   les générer (équipes qualifiées, ou choisies dans l'ordre des seeds), les renommer, changer leur type (sans match),
   les réinitialiser ou les supprimer (confirmation qui dit combien de résultats sont perdus). Une phase qui suit des
   poules se génère toute seule à leur qualification (« Générer quand même » reste possible) ; faite dès qu'une phase est générée.
5. **Matchs** (`matchs/<phase>`) : en haut, **« À faire maintenant »** (poules en cours, poules finies → « Qualifier les
   équipes », arbre qualifié pas généré, arbre d'une seule équipe ou sans équipe avec la raison, arbres en cours, « Tournoi
   terminé » seulement quand tout est joué, avec les vainqueurs) ; un onglet par phase, un onglet **Qualification** juste après une phase de poules
   (`matchs/qualification-<phase>` : classements, matchs encore à jouer, « Clore les poules », règles pré-remplies : la
   moitié haute vers la 1re phase suivante, le reste vers la 2e ; « Qualifier » génère les arbres et ouvre le premier), et un pour les matchs bonus, ouvert sur la première phase qui a
   un match à jouer. Poules : classements avec les égalités à trancher, matchs **tour par tour** (tour en cours
   déplié, les autres repliés, « Ouvrir les vétos du tour N »), « Clore les poules maintenant » (les matchs pas
   joués sont annulés) ; classement avec les rounds gagnés-perdus et l'ordre de départage (points, confrontations
   directes, différence de rounds, rounds gagnés ; l'ordre affiché d'une poule à égalité est celui retenu) ; arbre **dessiné en arbre** (une colonne par tour, bracket du haut, du bas, grande finale ; matchs numérotés M1, M2…,
   « Vainqueur M3 » / « Perdant M1 » tant qu'une équipe n'est pas connue ; un match se place entre ceux qui
   l'alimentent, exempts compris ; clic sur un match = sa ligne d'actions sous l'arbre ; 2 équipes = une finale), classement ; format de
   toute une phase ou d'un bracket ; une phase pas encore générée se génère aussi depuis son onglet. Chaque match :
   état de son véto (lien vers la page du véto), lancer le game suivant (vers sa console), et derrière ses boutons
   forfait, format, remplacer une équipe, saisir un résultat, **corriger le résultat** d'un match fini (le game et ses
   scores pré-remplis) ; la grande finale dit « X part avec 1 map d'avance (compté dans le score) ». Générer des poules
   avec trop de poules pour les équipes est signalé avant l'envoi.

**Sandbox** (`/admin/sandbox`, lien sur le tableau de bord) : préparer un tournoi de test - nombre d'équipes, de poules,
format des poules, après les poules (Élite et Amateur / un seul arbre / rien), qualifiés en Élite par poule, formats des
arbres, « s'arrêter à » (équipes et phases créées, poules générées, poules jouées, qualifiés avec arbres générés, tout
joué), joueurs et stats factices, résultats logiques (la meilleure tête de série gagne 3 fois sur 4) ou aléatoires
(50/50), rythme instantané ou **au fur et à mesure** (secondes par game, matchs en même temps). Scores variés : 13-x,
parfois des prolongations (16-14, 19-17). Équipes et joueurs factices (le 1er joueur est capitaine), pool de 7 maps ;
l'écran de gestion du tournoi s'ouvre ensuite. Au fur et à mesure : une barre « Simulation en cours » en haut de l'écran
du tournoi (phase, séries et games joués, Pause / Reprendre / Game suivant / Arrêter) le rafraîchit toutes les 2,5 s ;
un match réglé à la main pendant ce temps (résultat, forfait) est laissé par la simulation. C'est un tournoi normal (à
supprimer depuis son écran).

Couleurs d'état du cahier des charges : vert = en jeu, ambre `pause` = en pause (distinct de l'orange T), rouge = à
faire maintenant ; les erreurs sont en `red-light`.

- **Développement** (Windows ou Linux, Node installé) : `cd frontend && npm install && npm run dev` → http://localhost:5173,
  rechargement instantané ; les appels `/api`, `/auth`, `/login`, `/view`, `/veto`, `/sandbox`, `/assets`, `/socket.io`
  partent vers le backend (`GG_BACKEND`, défaut http://localhost:8081, stack lancée par `make up`). Le cookie de
  session de `localhost:8081` vaut aussi pour `localhost:5173` (les cookies ignorent le port).
- **Servi par le backend** : `make front` compile dans un conteneur Node (aucune installation) vers `frontend/dist` ;
  `make up` le refait seulement si une source a changé. Le backend (`FRONT_DIST`, `/front` en Docker) sert
  `/static/*` (noms hachés, cache long) et renvoie `index.html` pour toute page qui n'est pas une route serveur
  (`/api`, `/auth`, `/login`, `/view`, `/veto`, `/sandbox`, `/assets`, `/cs2`, `/socket.io`) : React Router affiche
  l'écran. Sans build, le backend le signale au démarrage et ses pages continuent de marcher.
- Style du code : `frontend/.prettierrc` (guillemets simples, virgules finales, 160 colonnes), appliqué par l'éditeur ou
  `../backend/node_modules/.bin/prettier --end-of-line auto --write "src/**/*.{ts,tsx}"` depuis `frontend/`. Les petites
  règles partagées des écrans de tournoi (match réglé, matchs restants, adresse d'un écran, ligne de véto, tailles des
  poules) vivent dans `pages/tournament/model.ts`, une seule fois.
- Fichiers de Vite sous `/static` (et non `/assets`, déjà pris par le CSS et les polices des pages serveur).

Les pages serveur restent en attendant d'être remplacées : le backend sert des pages HTML simples, sans JS (sauf rechargement sur `veto:updated`) : `/view`
(tournois, arbres, matchs), `/veto/:matchId` (+ `/admin`), `/login`, et les outils de dev `/sandbox` et
`/sandbox/tournament`. Leur style vit dans `backend/public/css/` (voir « Design des pages » dans
`docs/context/backend.md`). Toutes les données passent par l'API REST : un futur front pourra s'y brancher tel quel.

## Stack du front Vite (décidée le 2026-10-31, remplacée le 2026-11-05 par GGCoreFront : voir plus haut)
- **React + Vite** (TypeScript), routage côté navigateur (React Router) : aucun rechargement de page (exigence du
  cahier des charges, maintenue).
- **Servi par NestJS** : `npm run build` produit des fichiers statiques que le backend distribue sur son port (8081).
  En développement, le serveur Vite recharge l'écran instantanément et renvoie `/api`, `/auth` et `/ws` au backend.
- **Socket.IO client** pour le temps réel ; **Tailwind CSS** ; **shadcn/ui** restylé (voir Design).
- Responsive : PC, tablette, TV.

### Pourquoi pas Next.js (raisonnement du 2026-10-31, réévalué le 2026-11-05)
Next.js apporte surtout le rendu côté serveur (référencement, premier affichage d'un site public) et ses propres
routes serveur : rien dont une LAN a besoin. Il coûterait un deuxième serveur Node à lancer, surveiller et publier par
le tunnel, et deux origines (ports 3000 / 8081), donc du CORS et des cookies de session à faire passer. Servi par
NestJS, le front a la même adresse que l'API : la connexion (Steam, mot de passe admin) marche telle quelle.

**Réévalué le 2026-11-05** : ces coûts sont acceptés parce que GGCoreFront existe déjà avec son design, et que le proxy
Next donne une origine unique au navigateur (même cookie, pas de CORS). Contreparties : un conteneur de plus (`front`),
une IP fixe pour que `TRUST_PROXY` ne fasse confiance qu'à lui, et une image à reconstruire si l'adresse du backend
change (`BACKEND_URL` figée à la compilation).

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
- Même origine que le backend (le front Vite est servi par NestJS ; le front Next passe par son proxy) : REST `/api/...`,
  Socket.IO `/socket.io`
- Auth : la session existante (cookie `gg_session` posé par `/login`), aucun jeton à gérer côté front ; le WebSocket
  reconnaît aussi un admin par ce cookie
- Une seule connexion Socket.IO pour toute l'app (`lib/live.ts`) ; un écran suit un match par `match:subscribe`
- Rooms : `match:{id}:public` (tous) et `match:{id}:admin` (admins)
- **Erreurs** (`lib/api.ts`, `components/errors.tsx`) : tout refus de l'API (et toute erreur JS non attrapée) s'affiche dans
  une **popup** en bas à droite (statut, raison de l'API, « Détails pour le diagnostic » : méthode, adresse, ce qui a été
  envoyé, bouton Copier) et dans la **console** du navigateur (`[API] 409 POST … : raison`). Les relevés périodiques
  (`usePolling`, console de match) passent `quiet` : leur erreur reste affichée à côté des données. Côté backend, chaque
  refus est journalisé (`[HTTP] 409 POST /api/… - raison (admin)` dans `docker logs ggcore-backend-dev`).

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

### Console admin (admin uniquement)
- `admin:action` : une commande de la console a été passée (`action`, `by`, paramètres, `at`).

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

CORS : inutile pour le navigateur (même origine, directe ou par le proxy Next) ; `CORS_ORIGIN` ne sert qu'à d'éventuels
clients externes (défaut `http://localhost:3000`).
