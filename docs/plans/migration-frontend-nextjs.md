# Plan de migration : `frontend/` (React + Vite) → Next.js (projet GGCoreFront)

> **État au 2026-11-05** (détail et mode d'emploi : `docs/context/frontend.md`)
>
> - Fait côté backend et sur `main` : B1 (login et déconnexion en JSON), B2 pour le véto et `GET .../connect`, B3a (`/socket.io`
>   public, `TRUST_PROXY`), B5a (service `front`, `make web`). Reste B2 (lectures publiques de `/view`, sandbox), B3b, B4, B5b : à la parité.
> - Fait côté front (dépôt GGCoreFront, branche `feat/migration-gg-core`) : F0 à F2 et l'essentiel de F3, les écrans du Vite
>   étant repris dans `src/legacy/` ; correctif Socket.IO du proxy (slash final) ; routeur ; arbres publics ; Sandbox match ;
>   Messages en jeu. Vérifié dans Chrome contre la stack : 20 écrans sans erreur, live, flux de création.
> - Reste : porter `src/legacy/` en routes Next, écrans des fonctions sans interface (sponsors, restauration de round, appels
>   admin, alias), flux admin longs et login Steam à vérifier, puis la bascule (retrait du Vite et des pages HTML du backend)
>   après un tournoi complet joué avec le front Next.

## 0. Décisions prises avec l'utilisateur
| Sujet | Décision |
|---|---|
| Hébergement du front | **Serveur Next séparé** (Next standalone, conteneur dédié, port 3000) |
| Session / origine | **Proxy Next (rewrites)** : le navigateur ne parle qu'à Next ; `/api`, `/auth`, `/socket.io` sont relayés au backend (`BACKEND_URL`, côté serveur Next). Front et backend peuvent être sur des IP différentes : une seule origine pour le navigateur, cookie `gg_session` inchangé, pas de CORS, pas de HTTPS. |
| Dépôt | GGCoreFront **intégré dans GG-Core** à la place de `frontend/` (monorepo) |
| Charte | **Thème GGCoreFront** (shadcn v4 / Base UI, sombre bleu électrique) ; la doc design de GG-Core est réécrite |
| Périmètre | **Tous les écrans Vite** + pages équipes/matchs/serveurs de GGCoreFront rebranchées ; **toutes les pages HTML du backend** (`/view`, `/veto`, `/login`, `/sandbox`) passent dans Next |
| Connexion | Page login dans Next + endpoints JSON (`/auth/local`), retour Steam vers l'URL publique du front |
| Adresse du backend (V0) | `BACKEND_URL` fixée à la compilation de l'image Next (validé par l'utilisateur le 2026-11-01) ; changer d'adresse = reconstruire |
| Plan front détaillé | aussi dans `D:\gglan\GGCoreFront\docs\plan-migration-gg-core.md` |
| Infra | Service Docker `front` dans compose dev / CI + process dans le monolithe ; `make up` le lance |
| Suppression de `frontend/` | Seulement à la parité complète |

## 1. État des lieux (constats)
- `frontend/` (Vite) : `/` (tournois), `/admin` (dashboard, polling 5 s), `/admin/games/:gameId` (console de match), `/admin/sandbox`, `/admin/tournaments/:id/*` (5 étapes : tournoi, équipes, véto, phases, matchs/qualification/bonus, simulation). Libs : `lib/api.ts` (erreurs en popup + console, `quiet`), `lib/live.ts` (une seule connexion Socket.IO, `match:subscribe`), `lib/session.tsx` (`/auth/me`), `usePolling`, `pages/tournament/model.ts`.
- GGCoreFront (Next 16.1.6, React 19.2, Tailwind 4, shadcn v4/Base UI, lucide, motion) : login factice, dashboard, équipes, matchs, serveurs. Branché sur une **API qui n'existe plus** (`/tournaments`, `/teams`, `/maps`, `/admin/bind`, `/admin/sides`, `/tournaments/sync`, `/tournaments/status`, `/matches?page`, `DELETE /matches/:id`). `lib/api.ts` vise `http://localhost:8081/api` sans `credentials`. `lib/socket.ts` ouvre **une socket par match** (`query.matchId`, transport websocket seul).
- Backend : sert `frontend/dist` (`main.ts:serveFront`, `FRONT_DIST`, `SERVER_PATHS`), pages HTML `/view`, `/veto/:matchId(/admin)` + formulaires POST (`rps`, `start`, `step`, `undo`, `reset`), `/login`, `/sandbox` + `/sandbox/tournament` (HTML + actions), CSS `backend/public/css`. Auth : cookie `gg_session` HttpOnly SameSite=Lax, `/auth/local` et `/auth/steam/return` répondent par **redirections**, `/auth/logout` en GET, `/auth/me` JSON. `AuthMiddleware` redirige les pages vers `/login` du backend. `publicBase()` = `AUTH_PUBLIC_URL` sinon `x-forwarded-proto` + `Host`. `trust proxy` = 1. Gateway Socket.IO `cors: origin true, credentials`.
- Monolithe **obsolète, non aligné sur le dépôt** : `Dockerfile` référence `parser/` et `backend/ggbot-backend/` (chemins disparus), enchaîne plusieurs images finales ; `NEST_PORT=3000` n'est jamais lu (Nest écoute 8081 en dur, `main.ts:67`). Pas de conflit de port réel, mais l'image est à reconstruire.
- Parseurs : `/auth` n'a que `urlencoded` (`main.ts:26`) ; pas de `json()`.
- `isPublic()` ne reconnaît que `/ws` (`auth.middleware.ts:59`) alors que Socket.IO est sur `/socket.io` (chemin par défaut) : le polling HTTP serait refusé.

---

## 2. Plan BACKEND

### B1. Auth en JSON (sans casser les formulaires tant que `frontend/` existe)
- `main.ts` : ajouter `app.use('/auth', json({ limit: '16kb' }))` à côté du `urlencoded` existant.
- `POST /auth/local` : si `Accept: application/json` (ou body JSON) → `200 { ok, session }` / `401 { message }` / `429 { message, retryAfter }` ; sinon comportement actuel (redirections). Throttle inchangé.
- `POST /auth/logout` (JSON, 204) ; garder `GET /auth/logout` le temps de la transition.
- `GET /auth/me` : inchangé (déjà JSON).
- Tests : `/auth/local` en JSON (200, 401, 429 + `Retry-After`) et en formulaire (redirections inchangées).
- Steam : `GET /auth/steam?next=` → retour `GET /auth/steam/return` qui redirige vers `next` (chemin local validé par `safeNext`, donc servi par Next). **Une seule origine canonique : `AUTH_PUBLIC_URL`** = URL du front vue par le navigateur (ex. `http://<ip-front>:3000`), utilisée pour le realm OpenID, `return_to` et toute redirection absolue ; pas de `FRONT_PUBLIC_URL`. Sans `AUTH_PUBLIC_URL`, `publicBase()` retombe sur `Host` / `X-Forwarded-Host` transmis par Next (à vérifier sur l'image standalone, et ne lire `X-Forwarded-Host` que si la requête vient du proxy de confiance).
- Erreurs Steam / refus : redirection vers `/login?error=` **du front** (même chemin, servi par Next).

### B2. API JSON pour remplacer les pages HTML
- **Véto** : ajouter les équivalents JSON sous `/api/tournament/matches/:id/veto/{rps,start,step,undo,reset}` (même `VetoService`). **Étendre `isCaptainAction`** (`auth.middleware.ts:67`, regex actuelle `^/veto/[^/]+/(rps|start|step)$`) au nouveau préfixe `/api/tournament/matches/:id/veto/(rps|start|step)` ; `undo` / `reset` restent admin. Tests visiteur / joueur capitaine / joueur d'une autre équipe / admin pour chaque action, à côté du `GET /api/tournament/matches/:id/veto` existant. Les événements `veto:updated` restent la source temps réel.
- **Infos de connexion d'un match** : `/view/matches/:id` appelle `connectInfo()` (`tournament-launch.service.ts:240`) : GOTV pour tous, adresse + mot de passe seulement pour les joueurs du match ou les admins. Nouvel endpoint JSON `GET /api/tournament/matches/:id/connect` qui applique ces règles depuis la session côté backend, avec **`Cache-Control: private, no-store`**. Tests : en-tête présent ; pour un visiteur ou un joueur d'une autre équipe, l'objet `play` (adresse + mot de passe) est **entièrement absent**, seul `watch` (GOTV) reste.
- **View** (`/view`, `/view/tournaments/:id`, `/view/matches/:id`) : vérifier que toutes les données affichées sont déjà dans l'API publique (`GET` lisibles par un visiteur) ; ajouter les lectures manquantes (ex. vue publique d'un arbre/poules, scoreboard d'un match) sans exposer les champs admin.
- **Sandbox** (`/sandbox`, `/sandbox/tournament`) : les actions sont déjà des routes JSON hors `/api` ; **elles restent sous `/sandbox/*`** (admin seulement), car `make replay` (`Makefile:113`), les scripts et les tests les appellent directement ; le rewrite Next `/sandbox/:path*` est donc obligatoire. Retirer seulement leur rendu HTML (`GET /sandbox`, `GET /sandbox/tournament`, `sandbox.html.ts`), à la bascule.
- Lister dans un tableau chaque appel de GGCoreFront vers l'ancienne API et décider : **adapter le front** à l'API actuelle (par défaut) ou **ajouter un endpoint** si le besoin est réel (ex. `GET /api/maps` = pool de maps connu ; liste globale des équipes). Aucun endpoint « Toornament » (`sync`, `status`) n'est recréé.

### B3. Accès et réponses
**B3a, dès l'étape 1** (avant le premier login ou la première socket via Next) : `TRUST_PROXY`, `/socket.io` public et leurs tests (deux points ci-dessous). **B3b, à la bascule** : suppression des réponses HTML du middleware et ajustement final de CORS.
- `AuthMiddleware` : ne plus rediriger vers `/login` ni renvoyer de page HTML une fois les pages supprimées ; toute route non publique répond `401/403` JSON. Mettre à jour `isPublic` (retrait de `/view`, `/veto/*` pages ; ajout des routes JSON publiques).
- `trust proxy` : aujourd'hui `1` global (`main.ts:17`) et le backend est publié sur l'hôte (`8081:8081`) : un client qui contourne Next peut forger `X-Forwarded-For` et fausser le throttle (`req.ip`). Topologie retenue : **le navigateur passe par Next** ; le backend reste publié seulement pour les agents (`/cs2/logs`) et l'outillage, et `trust proxy` ne fait confiance qu'au réseau Docker du front (**IP Docker fixe** pour le service `front` via `ipv4_address` sur un réseau compose dédié, et `trust proxy` = cette seule IP, variable `TRUST_PROXY` ; jamais `uniquelocal`, qui ferait confiance à tout client du LAN ; valeurs : IP fixe du `front` en dev et en CI, `loopback` dans le monolithe où Next et Nest partagent le conteneur ; tests B3a lancés une fois la topologie B5a en place). Tests : accès via Next (IP client réelle), accès direct (IP de la socket), `X-Forwarded-For` forgé en direct ignoré.
- CORS : plus nécessaire pour le navigateur (même origine via Next). Garder `CORS_ORIGIN` pour les clients externes, défaut vide ; gateway Socket.IO : restreindre `origin` à la même liste.
- Socket.IO : chemin par défaut `/socket.io` ; **`isPublic()` doit accepter `/socket.io` pour toutes les méthodes** (l'authentification reste au `SocketAuthGuard`), sinon le transport polling (POST) reçoit 401/403. Corriger la doc (`/ws` → `/socket.io`). Tests : handshake WebSocket et polling, avec et sans cookie admin.

### B4. Retrait de ce que Next remplace (à la parité, phase finale)
- `main.ts` : supprimer `serveFront`, `FRONT_DIST`, `SERVER_PATHS`, et les exclusions de `setGlobalPrefix` devenues inutiles (`login`, `view`, `veto`).
- Supprimer `ViewController`, rendu HTML de `VetoController` (garder la logique), `GET /login`, `adminOnlyPage`, `htmlPage` et `backend/public/css` s'ils n'ont plus d'usage.
- Mettre à jour les specs touchées (auth, sandbox, middleware) et le Golden Master **non concerné** (aucun changement de règles de match).

### B5. Infra / build
- **B5a (coexistence)** `docker-compose.dev.yml` : ajouter le service `front` (image Next standalone, build-arg `BACKEND_URL=http://backend:8081`, port `3000:3000`, IP fixe) **sans toucher** au volume `../frontend/dist:/front` ni à `FRONT_DIST` : le Vite reste servi par 8081.
- **B5b (bascule finale)** retirer le volume `../frontend/dist:/front`, `FRONT_DIST` et la cible `make front`.
- `docker-compose.ci.yml` : **obligatoire** : service `front` + runner Playwright ; healthcheck via `front:3000` (page + `/api/health` à travers le rewrite), login/cookie, connexion Socket.IO.
- Monolithe : **reconstruire** le `Dockerfile` (étapes `agent/`, `backend/`, Next standalone, une seule image finale), Nest sur 8081, Next sur 3000, process Next dans `supervisord.monolith.conf` ; ajouter `docker build` + smoke test du monolithe aux validations.
- `Makefile` : en B5a, **garder** la cible Vite `front` et la dépendance `_core: frontend/dist/index.html`, et **ajouter** une cible distincte `web` (construction de l'image Next) ; `make up` lance aussi `front`. En B5b seulement, supprimer la cible Vite et la dépendance de `_core`.
- Variables : `BACKEND_URL` (**argument de build** de l'image front : les rewrites sont figés au `next build` en standalone ; défaut `http://backend:8081` = nom du service Docker, donc stable quelle que soit l'IP LAN des machines ; si un jour le backend tourne sur une autre machine que le front, reconstruire l'image avec la bonne valeur), `AUTH_PUBLIC_URL` (backend, origine canonique du front), `TRUST_PROXY` (backend), retrait de `FRONT_DIST`.

---

## 3. Plan FRONT (Next.js, dossier `frontend/` à terme)

### F0. Import du projet
- Copier GGCoreFront dans `GG-Core/web/` (nouveau dossier, pour cohabiter avec `frontend/` pendant la migration) ; renommé `frontend/` à la fin. Historique : `git subtree add` ou copie simple (à choisir).
- **Monter Next sur la dernière 16.x corrigée** (16.1.6 est touchée par des failles du proxy WebSocket / rewrites, corrigées en 16.2.x : vérifier les avis GitHub au moment du chantier) ; garder React 19 / Tailwind 4 / shadcn v4 (Base UI, prop `render`, pas `asChild`). Fusionner `CLAUDE.md` du front dans `docs/context/frontend.md` et `AGENTS.md`.
- `next.config.ts` : `output: 'standalone'`, `rewrites()` vers `BACKEND_URL` (lu au build) pour `/api/:path*`, `/auth/:path*`, `/socket.io/:path*` et `/sandbox/:path*`. Le serveur Node de Next (standalone compris) relaie l'upgrade WebSocket des rewrites externes : **le prouver dès F0** sur l'image standalone (upgrade, cookie au handshake, reconnexion après redémarrage du backend). Repli : polling Socket.IO (possible grâce à `isPublic` corrigé). `allowedDevOrigins` à garder pour le dev LAN.
- Scripts : `dev`, `build`, `start`, `lint`, `typecheck` (`tsc --noEmit`).

### F1. Socle (à faire avant les écrans)
- `lib/api.ts` : chemins **relatifs** (`/api/...`), `credentials: 'same-origin'`, gestion d'erreur reprise du Vite (popup bas-droite + `console` `[API] 409 POST … : raison`, option `quiet`), 401 → redirection vers `/login?next=`.
- `lib/live.ts` : **une seule** connexion Socket.IO (chemin relatif, cookie), `match:subscribe` / `match:unsubscribe`, reconnexion auto ; supprimer `lib/socket.ts` (une socket par match).
- Session : `SessionProvider` (`/auth/me`), garde des routes admin côté client (et/ou `proxy.ts` (ex-`middleware.ts` en Next 16) limité à une redirection optimiste si le cookie est absent ; l'autorité reste le backend).
- Hooks : `usePolling`, `useApi` repris du Vite ; types API regénérés à partir des DTO backend (ou copiés à la main, liste à tenir).
- Composants transverses : barre/sidebar (`AppSidebar`) avec état du lien live, popup d'erreurs, couleurs d'état (vert = en jeu, jaune = pause, rouge = à faire / erreur).
- Tous les écrans interactifs en Client Components (`"use client"`) ; pas de fetch serveur vers le backend au départ (simple, et le cookie n'a pas à être relayé par Next).

### F2. Pages publiques et connexion
- `/login` : formulaire mot de passe admin (fetch `POST /auth/local` JSON), bouton « Se connecter avec Steam » (`/auth/steam?next=`), message `?error=`, lien vers les tournois.
- `/` et `/view/...` → routes publiques : liste des tournois, page tournoi (poules, arbre dessiné, classements), page match (scoreboard live via Socket.IO).
- `/view/matches/[id]` : bloc « Se connecter » (GOTV pour tous ; adresse + mot de passe selon `GET /api/tournament/matches/:id/connect`).
- `/veto/[matchId]` : véto capitaine/public (pierre-feuille-ciseaux, pick & ban, temps réel `veto:updated`) ; `/veto/[matchId]/admin`.
- « Mes vétos » joueur : `GET /api/tournament/vetos/mine`.

### F3. Admin (parité Vite)
- `/admin` : dashboard (games en cours, serveurs, tournois ; polling 5 s).
- `/admin/games/[gameId]` : console de match (actions admin, flux live, pause, sides, review).
- `/admin/tournaments/[id]/[[...step]]` : 5 étapes avec barre d'étapes, « Étape suivante », onglets phases / qualification / bonus, arbre dessiné, actions par match (forfait, format, remplacement, résultat, correction), barre de simulation. Reprendre `pages/tournament/model.ts` tel quel.
- `/admin/sandbox` (tournoi de test) + `/admin/sandbox/match` (ancienne `/sandbox` : injection, replay, RCON simulé).
- Pages GGCoreFront existantes : **serveurs** (rebrancher sur `/api/tournament/servers`), **matchs** et **équipes** : fusionner dans les écrans tournoi ou rebrancher sur les routes actuelles ; supprimer `tournament-context` « tournoi sélectionné » si inutile.

### F4. Qualité
- `npm run typecheck`, `npm run lint`, `npm run build` dans le CI (remplace `make front`).
- Tests : au minimum smoke tests (Playwright) sur login, dashboard, une étape tournoi, véto ; `make e2e-tournament` doit passer avec le front Next.
- Vérification manuelle LAN : front et backend sur deux IP, login mot de passe, login Steam (avec Internet), socket live, véto à deux navigateurs.

---

## 4. Ordre de livraison
1. B1 + B3a + F0/F1 (proxy, session, socket unique, login) — le cœur technique ; valider le WebSocket via le proxy **en premier**.
2. B5a (service `front` ajouté dans compose dev et CI) — les deux fronts coexistent (`frontend/` servi par 8081, Next sur 3000).
3. F3 admin (dashboard → console → tournoi → sandbox) + B2 sandbox.
4. B2 véto/view + F2 pages publiques.
5. Bascule : B3b + B4 + B5b (suppression pages HTML, `serveFront`), suppression de `frontend/` Vite, renommage `web/` → `frontend/`, monolithe, docs (`AGENTS.md`, `docs/context/frontend.md`, `backend.md`, `infra.md`), `docs/session-de-test.md`.

## 5. Risques
- Upgrade WebSocket à travers les rewrites Next (à prouver en étape 1).
- Steam OpenID : `return_to`/realm doivent être l'URL du front ; mauvais `Host` → login Steam cassé.
- Throttle login : toutes les requêtes viennent de l'IP de Next si `trust proxy` est mal réglé → un attaquant bloque tout le monde, ou le throttle ne voit plus rien.
- Un serveur Node de plus en LAN (redémarrage, supervision) — accepté par l'utilisateur.
- Volume du portage (tournoi en étapes = gros écran) ; garder `frontend/` Vite servi en parallèle jusqu'au bout.
