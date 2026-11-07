# Backlog & TODOs - GG-Core

Ce fichier centralise les chantiers, fonctionnalités à venir, améliorations architecturales et tâches techniques identifiées pour atteindre le **MVP complet** de GG-Core (successeur moderne d'eBot pour CS2 en LAN).

---

## 🚀 Périmètre MVP Restant (Fonctionnalités Clés à Livrer)

Le cœur moteur de match, l'arbitrage automatisé, le calcul de scores/stats CS2 et le replay de logs sont opérationnels. Les chantiers ci-dessous constituent ce qui manque pour un tournoi LAN opérationnel de bout en bout :

### 1. 🖥️ Frontend Next.js (GGCoreFront) : Admin, Spectateur, Joueur
* **Origine & Spécifications** : [`docs/cahier-des-charges.md`](file:///d:/DEV/GG-Core/docs/cahier-des-charges.md) et [`docs/context/frontend.md`](file:///d:/DEV/GG-Core/docs/context/frontend.md).
* **État actuel (2026-11-05)** : le front est le projet GGCoreFront (Next.js, dépôt voisin, `make web`), décidé avec
  l'utilisateur ; le front React + Vite (`frontend/`) et les pages HTML du backend restent jusqu'à la parité. Vérifié dans
  Chrome contre la stack : 20 écrans sans erreur, live, un tournoi monté et déroulé dans l'interface (équipes, véto, poules,
  résultats, arbres, qualification, véto joué par l'admin), sandbox match. Détail, reste à faire et pièges (Socket.IO et le
  slash final) : `docs/context/frontend.md`.
  **Reste** : login Steam, véto de vrais capitaines et lancement d'un game à vérifier ; porter `src/legacy/` en routes Next ; écrans
  des fonctions déjà dans le backend (sponsors, restauration de round, appels admin, alias et templates) ; puis retirer
  `frontend/` et les pages HTML du backend après un tournoi complet joué avec le front Next.
  **Actions admin sur un match en cours** (forcer la phase : échauffement, knife, prolongation ; corriger le score à la
  main) : n'existent pas dans `main`, voir `docs/context/frontend.md`. Le score n'est pas applicable en jeu sans
  plugin : il faudrait passer par une sauvegarde de round (Round Doctor), pas par une simple commande RCON.
  Historique public d'un match : route filtrée à créer.
* **Tâches à réaliser** :
  - **Initialisation** : projet React + Vite (TypeScript, React Router, Tailwind CSS avec la charte de `base.css`,
    shadcn/ui restylé, client Socket.IO), compilé et servi par NestJS (choix et raisons : `docs/context/frontend.md`).
  - **API de la console admin faite** (2026-10-31) : games en cours, équipes et joueurs d'un tournoi, détail d'une
    série en JSON, commandes de match (pause, reprise, départ forcé, échange des camps, rejouer un round, message),
    journal du match, modification / retrait des tournois, équipes, joueurs et serveurs (`docs/context/backend.md`).
  - **Écran de gestion d'un tournoi fait** (2026-10-31) : équipes et joueurs, phases (poules, arbre, qualification,
    égalités), opérations du jour J sur chaque match, matchs bonus (`docs/context/frontend.md`).
  - **Interface Administrateur** :
    - Dashboard de gestion des tournois, poules, matchs et affectations de serveurs.
    - Console de match en direct avec commandes d'arbitrage 1-clic (pause, reprise, swap de camp, redémarrage, changement de map, restauration de backup).
    - Suivi en temps réel de la flotte des serveurs CS2 (`IDLE`, `BUSY`, `OFFLINE`).
  - **Interface Publique (Spectateurs / TV LAN)** :
    - Scoreboard en direct branché sur WebSocket (`score:update`, `kill`, `assist`, `bomb:planted`, `bomb:defused`, `sides:swapped`).
    - Statut de round, timer de freeze/live, progression de la bombe et séries de victoires/défaites (streaks).
    - Vue de l'arbre du tournoi et du classement des poules.
  - **Interface Joueur (Portail LAN)** :
    - Planning de l'équipe (heure du match, nom du serveur, carte jouée).
    - Notification « Match prêt » avec bouton 1-clic **« Se connecter »** générant l'URI `connect IP:PORT; password PWD`.
    - Indicateur de statut de connexion / vérification de Whitelist SteamID.

### 2. 🏆 API Métier Tournois, Poules, Brackets & Équipes
* **Fait** : tournois, équipes, joueurs / capitaines, poules (round robin, classements, qualification), double
  élimination (grande finale avec map d'avance), lancement des games sur un serveur choisi, résultat automatique ou
  saisi → série → arbre, vues `/view`, simulation, et les opérations admin du jour J : forfait, format à la volée
  (un match, ou une phase / un bracket entier), remplacement d'une équipe, matchs bonus (fun ou pour une place,
  intégrés au classement final) - `docs/context/backend.md`.
* **Reste** :
  - Import des équipes / joueurs par CSV (format à voir avec le dev du site d'inscription).
  - Annuler un forfait (pas fait). Corriger le résultat d'un match fini : fait le 2026-11-01
    (`POST matches/:id/games/:order/correct`, les équipes envoyées aux matchs suivants sont reprises).

### 3. 🗺️ Module de Vétos de Maps (Map Pick & Ban)
* **Fait** : pierre-feuille-ciseaux puis véto BO1 / BO3 / BO5 sur la page `/veto/:matchId` (capitaines connectés avec
  Steam, désignés par l'admin), mode de side knife ou pick par tournoi / phase, maps → games de la série, lancement sur
  la map et les sides du véto (`docs/context/backend.md`). Camps des joueurs en mode de side « pick » : quand les deux
  équipes sont prêtes, chaque joueur des rosters doit être dans le camp de son équipe (suivi des lignes
  `switched from team`) : bon camp → décompte ; les deux équipes inversées → `mp_swapteams` puis décompte ; sinon
  lancement bloqué, joueurs mal placés nommés dans le chat, alerte admin `sides:misplaced`, `!ready` à retaper. Pas de
  kick. Noms d'équipe en jeu posés ensuite (`mp_teamname_1` = équipe CT) : vérifié sur le serveur, `mp_swapteams`
  déplace les joueurs mais pas les noms (RT-10).
* **Reste** :
  - Import des capitaines par CSV (avec l'import des équipes, format à voir avec le dev du site d'inscription).
  - Vétos des poules ouverts tour par tour (l'admin peut ouvrir un tour en avance) : fait le 2026-10-31.
  - Minuteur par étape (ban aléatoire) : écarté pour l'instant, l'admin débloque à la main.
  - Le backend pousse `veto:updated` (WebSocket) ; la page de test s'en sert déjà pour se recharger, le futur front
    mettra l'écran à jour sans rechargement.
  - Camps en mode « pick » : test avec de vrais joueurs (RT-09). Joueurs déjà dans un camp avant le lancement (pas de
    ligne `switched from team` après) : non suivis, le contrôle ne les voit pas.
  - Mode knife : la même erreur (équipes inversées par rapport à home = CT) attribuerait le knife à la mauvaise
    équipe ; non contrôlé.
  - **Front voulu** (la page `/veto/:matchId` actuelle n'est qu'un outil de test) : d'abord un écran
    pierre-feuille-ciseaux, puis un écran pick & ban où l'on clique sur l'image de chaque map. Images servies en local
    (LAN-first), à fournir. Garder séparés l'écran capitaine et l'écran admin (comme les pages de test `/veto/:id` et `/veto/:id/admin`) : un admin qui est aussi capitaine
    a cliqué pour l'adversaire pendant son tour (test du 2026-10-30, refus propre côté serveur).

### 4. 🔒 Sécurité des Accès Serveurs & Whitelist SteamID
* **Origine** : Protection des matchs LAN contre les intrusions ou erreurs de connexion.
* **Fait** : au lancement d'un game de tournoi, mot de passe aléatoire (`sv_password`) et whitelist = roster complet
  des deux équipes (titulaires et remplaçants) + admins Steam ; un joueur non inscrit est kické à sa connexion
  (`kickid <userid> "Vous n'êtes pas inscrit sur ce match"`) et les admins sont alertés (`access:not_allowed`) ;
  désactivable au lancement (`access: { password: false, whitelist: false }`) ; boutons « Se connecter » (joueurs du match, admins) et « Regarder (GOTV) » (tous sauf les joueurs du match, GOTV ouverte en différé) sur
  `/view/matches/:id` pour les joueurs du match et les admins.
* **Reste** :
  - Test avec de vrais joueurs (RT-11).
  - Joueurs déjà sur le serveur au lancement : non contrôlés (le kick post-match du match précédent vide le serveur).
  - Pas de whitelist si une équipe n'a encore aucun SteamID (import CSV à venir).

### 5. 🌐 Orchestration Dynamique de la Flotte de Serveurs (Multi-serveurs)
* **Origine** : Objectif de superviser jusqu'à 32 (ou 64) serveurs simultanément en LAN.
* **Fait** : serveurs enregistrés en base avec leur disponibilité (`free` / `busy` + match en cours / `disabled`),
  game lancé sur le serveur choisi par l'admin (409 si occupé ou désactivé), PC mort désactivé, serveur bloqué libéré
  à la main ; en fin de match, reset warmup différé et kick des joueurs restés connectés. Ajout d'un serveur en une
  commande (`make server` : agent, enregistrement, lignes de config CS2, contrôle RCON) et état de chaque serveur
  (`make servers` : RCON, logs reçus, mauvais jeton).
  Lancement d'un game sans serveur : le premier serveur libre dont l'agent est connecté en RCON.

### 6. 🔑 Authentification & Gestion des Rôles (JWT)
* **Fait (V1)** : connexion Steam (admin si SteamID dans `GG_ADMIN_STEAMIDS`, joueur si SteamID connu) ou mot de
  passe admin hors ligne (10 essais par minute et par adresse), session JWT en cookie HttpOnly, jeton Bearer pour les
  scripts ; toute modification et le Sandbox réservés aux admins ; rooms WebSocket `match:{id}:public` /
  `match:{id}:admin` avec garde JWT (`docs/context/backend.md`).
* **Reste** :
  - Rôle arbitre distinct de l'admin, si le besoin se confirme (aujourd'hui : admin ou non).
  - HTTPS de la LAN : voir §12 bis (mis de côté).

### 7. 📊 Export des Données & Statistiques de Fin de Tournoi
* **Tâches à réaliser** :
  - Export CSV / JSON complet des scores de matchs, classements et statistiques individuelles des joueurs pour le débriefing d'après-tournoi.

---

## ⚙️ Améliorations & Outillage (Priorité Moyenne)

### 8. 🧪 Validation en jeu en suspens (joueur humain requis)
* Liste et procédures : [`docs/test-cases.md`](../test-cases.md), section « Tests sur serveur CS2 réel » → **RT-01 à RT-08**
  (`!pause` après la pose de bombe, `!tech` en fin de round, affichage de la banque de pause, TAB pendant l'entracte de fin,
  kick post-match, fin de la démo GOTV avec `tv_delay 105`, navigation round par round dans l'UI Sandbox).

### 9. 🔄 Synchronisation amont des CFG (« Online Pre-Cache, Offline Fallback »)
* **Origine** : Les CFG de tournoi de référence vivent sur [`DocR3D/GGLanCS2CFG`](https://github.com/DocR3D/GGLanCS2CFG).
* **Besoin** : Permettre à l'organisateur lors de la préparation des serveurs de synchroniser la dernière version des CFG sans risquer de bloquer le démarrage en LAN le jour J.
* **Tâches** :
  - Script ou endpoint pour télécharger et mettre en cache local les `.cfg` avec timeout court (`-m 3`).

### 10. 🎯 Statistiques avancées / Style Points (Non bloquant pour le MVP)
* **Besoin** : Exploiter les métadonnées de kills déjà extraites par l'agent Go mais non encore cumulées dans le snapshot :
  - Modificateurs de tirs : Wallbangs (`penetrated`), traversée de smoke (`throughsmoke`), No-scopes (`noscope`), tirs aveuglé (`attackerblind`), tirs en l'air (`attackerinair`).
  - Kills par arme spécifique (couteau, Zeus, HE, molotov).
  - Séries par round : 3K, 4K, 5K (Ace) et premiers frags du round (Entry frags).
* **Dégâts / ADR (méthode eBot)** : cumuler les lignes `"A" attacked "B" … (damage "N")` par round, en **plafonnant aux PV restants** de la victime (un tir AWP à 447 compte 100) et en excluant les dégâts sur coéquipier. Référence : `processAttacked` dans [eBot-CSGO `Match.php`](https://github.com/deStrO/eBot-CSGO/blob/master/src/eBot/Match/Match.php). Le champ `dmg` de `round_stats` peut servir d'oracle.
* **Multi-kills, clutchs, first kills (méthode eBot)** : compteurs par round comme eBot (`k1`…`k5` kills dans le round, `v1`…`v5` clutch 1vN gagné, `firstKill` premier frag du round), remis à zéro à chaque round et inclus dans la photo de début de round (rollback backup restore).
* **Lecture des blocs `round_stats` de CS2** : CS2 logge à chaque fin de round un bloc `JSON_BEGIN{ … "round_stats" … }}JSON_END` (par `accountid` : argent, kills, deaths, assists, dmg, hsp, adr, mvp, 3k/4k/5k, clutchk, firstk, pistolk, sniperk…). Le type `ROUND_STATS` existe mais aucun parser ne le lit (bloc multi-lignes).
  - Apporterait l'**argent exact par joueur** (aujourd'hui non suivi : les logs n'ont que `purchased` sans prix, ni revente) et toutes les stats ci-dessus « gratuitement », calculées par CS2.
  - Travail : accumulateur multi-lignes dans les **deux** parsers (Go + `parseCs2LineFallback`), `accountid` → `[U:1:…]`, handler backend (`setPlayerMoney`, dmg/ADR), exposition snapshot/scoreboard (~200 lignes, branche dédiée).
  - À vérifier : convar qui active ces blocs (présents à la GGLan avec `mp_logdetail 1`) ; le bloc arrive quelques secondes après la fin du round (argent du début de freeze time, pas pendant les achats). Note : eBot ne le lit pas non plus.

### 11. 📦 Dépôt d'outillage séparé (Log Anonymizer & Demo Parser)
* **Besoin** : Isoler les scripts locaux d'anonymisation de logs (`scratch/` et `scripts/`) dans un package CLI dédié pour les futurs tournois.

### 12. 🧰 Petites suites identifiées
* **Restauration de backup** : restaurer aussi l'économie (argent) comme CS2 ; aujourd'hui score, stats et séries seulement.
* **Parser de secours** : parser les commandes chat comme le parser Go.

### 12 bis. 🔒 HTTPS de la LAN (mis de côté)
* Aujourd'hui tout est en HTTP, comme eBot : sur le réseau de la LAN, une session admin circule en clair (lisible
  par quelqu'un qui écoute le réseau).
* Prêt sur la branche `feat/https-login` (non mergée, jugé trop contraignant pour l'instant) : certificat auto-signé
  créé par `make`, connexion et actions en HTTPS (8443), lecture en HTTP ; inconvénient : avertissement du navigateur
  une fois par poste. Sans avertissement : vrai certificat sur un sous-domaine de gglan.fr (challenge DNS).

### 12 ter. 🛟 Résilience aux coupures réseau (agent ↔ Redis, backend ↔ Redis)
* **But** : ne perdre aucun événement de match si un agent ou GG-Core est coupé un moment. Détail, cas couverts et
  manques : `docs/architecture.md` § « Résilience aux coupures ».
* Backend : lire `ggbot:events_primary:<sid>` (consumer group) à la place du Pub/Sub pour les événements de match.
* Agent : garder et renvoyer les lots quand Redis est injoignable (aujourd'hui jetés).
* Agent : clé `ggbot:server:<sid>:currentMatch` ≠ `server:<sid>:currentMatch` du backend (matchId toujours "unknown").

### 13. 🎥 Overlays OBS (score en direct sur le stream)
* **Besoin** : pages « source navigateur » pour OBS (score, prochain match, arbre, MVP de la map).
* **Prévu** : thème `overlay` (`backend/public/css/overlay.css` + `htmlPage({ theme: 'overlay' })`) : fond transparent,
  sans barre du site, 1920×1080 ; une adresse par serveur (`/overlay/server/:serverId/score`) qui suit le match en cours ;
  mise à jour par le WebSocket public, pas par rechargement (seule exception à « pages sans JS »).
* Audience WebSocket `overlay` (et `team` pour le portail joueur) : `docs/architecture.md` § « Flux d'événements ».
* V2 : agent CSTV (spectateur du flux GOTV) → télémétrie sur un canal Redis séparé → `events_secondary` → replay 2D en
  fin de partie (pas de positions en direct : pas de délai à gérer).

### 14. 🎨 Page charte du design
* Une page qui montre tous les éléments (titres, tableaux, boutons, formulaires, bloc ASCII, classes du vocabulaire de
  `base.css`) dans les deux thèmes : l'équivalent léger d'un Storybook, pour juger une modification du CSS d'un coup d'œil.

### 15. 📣 Message à tous les serveurs au moment de l'achat (buytime)
* **Besoin** : l'admin écrit un message une fois et il s'affiche dans le chat de tous les serveurs (ou d'une sélection)
  pendant la phase d'achat, quand les joueurs regardent l'écran. Exemple : « Quand vous avez fini ce match, vous pouvez
  aller manger ! ».
* **Pourquoi à l'achat** : c'est le seul moment où le message est lu sans gêner un round. Même principe que
  l'armement des pauses : le message est « armé » puis envoyé au prochain freeze time de chaque serveur, pas tout de
  suite (un serveur en plein round l'afficherait au mauvais moment, un serveur en pause ou en warmup n'a pas de
  buytime).
* **À prévoir** :
  - Cible : tous les serveurs avec un match en cours, ou une sélection.
  - Envoi unique ou répété (n rounds de suite), avec annulation tant qu'il n'est pas parti.
  - Un serveur sans match en cours (warmup, libre) : envoi immédiat ou ignoré, à choisir.
  - L'envoi passe par la file RCON de l'agent (6 commandes par seconde et par serveur) : sur 32 serveurs, pas de
    problème car la limite est par serveur.
  - Suivi : afficher à l'admin quels serveurs l'ont reçu et lesquels attendent encore.
  - La commande « message » d'un match existe déjà (console admin) : s'en servir comme brique, ajouter l'armement.
* **Lien avec le cahier des charges** : les messages sponsorisés dans le chat en jeu (rotation manuelle ou
  automatique, presets) reposent sur le même mécanisme d'envoi au buytime ; à faire ensemble.

### 16. 🔁 Rechargement à chaud du backend en dev (sous WSL)
* **Constat** (2026-11-07, session de test) : le backend du compose de dev se lance par `nest start --watch`, mais une
  modification du code source ne le recharge pas. Le dossier `backend/` est monté depuis le disque Windows (`/mnt/d/...`),
  où les notifications de fichiers n'arrivent pas dans le conteneur. `CHOKIDAR_USEPOLLING=1` est déjà posé dans
  `infra/docker-compose.dev.yml`, mais Nest compile avec le `tsc` en mode watch, qui ne lit pas cette variable : il lui
  faut ses propres variables (`TSC_WATCHFILE`, `TSC_WATCHDIRECTORY`). Aujourd'hui, chaque correctif demande un
  `docker compose restart backend` (environ 30 s, le site est coupé).
* **Pistes, à essayer dans cet ordre** :
  1. Ajouter dans le compose de dev `TSC_WATCHFILE=PriorityPollingInterval` et
     `TSC_WATCHDIRECTORY=DynamicPriorityPolling` (interrogation périodique au lieu des notifications), puis vérifier
     qu'un changement de fichier relance bien le backend.
  2. Sinon, cloner le dépôt dans le disque de WSL (`~/GG-Core`) : les notifications y fonctionnent, et les builds sont aussi
     plus rapides ; seul l'éditeur côté Windows doit alors ouvrir le dossier par `\\wsl$\Debian\...`.
* **À vérifier** : le rechargement ne doit pas couper une session de test en cours plus longtemps qu'un redémarrage (l'état
  d'un match est dans Redis, il survit) ; décider si on le laisse actif aussi pendant une vraie LAN (sans doute non : un
  rechargement en plein match est un risque, la LAN doit tourner sur une image figée).

### 17. 🎬 Tests de bout en bout « scénario joué, journal de sortie comparé »
* **Idée** (utilisateur, 2026-11-07) : jouer une suite de commandes, de rounds et d'actions sur le vrai serveur de test, puis
  comparer ce que GG-Core a produit (événements, score, phases, messages envoyés dans le chat, commandes RCON) avec un
  fichier de référence.
* **Ce qui existe déjà** : le Golden Master (`fixtures-golden-master.spec.ts`) rejoue de vrais logs CS2 et compare le
  résultat à `test/fixtures/expected-outcomes.json` ; `make replay F=...` rejoue un log dans la stack complète ;
  `make e2e-tournament` déroule un tournoi. Ils partent tous d'un **log déjà écrit**, jamais d'un scénario piloté.
* **Ce qui manque** : un scénario déclaratif (par exemple en JSON : « forcer le départ, attendre la fin du round, taper
  `!pause`, attendre 45 s, `!restore 3`… ») joué contre le serveur CS2 du conteneur (les bots jouent, les commandes de
  joueurs sont publiées sur le bus Redis comme le fait l'agent), avec :
  - un **journal de sortie normalisé** (heures et identifiants retirés) : lignes `say` et RCON reçues par le serveur,
    changements de phase, scores, événements enregistrés ;
  - la **comparaison** avec un fichier attendu, et un mode de régénération relu avant commit, comme le Golden Master.
* **Pièges vus pendant la session de test** : le timing (rounds courts, `mp_roundtime 0.5`), les rounds que les bots ne
  jouent pas (ils ne bougent pas : la fin vient du temps), l'état laissé par un scénario précédent (repartir d'un game
  neuf), et les commandes simulées de la Sandbox qui doivent transmettre leurs paramètres (corrigé le 2026-11-07).

### 18. ⏱️ Alerte aux admins quand une pause technique dure trop longtemps
* **Idée** (utilisateur, 2026-11-07) : prévenir les admins quand une **pause technique dépasse 2 minutes**. Une pause technique n'a
  pas de durée de fin (reprise par les deux équipes avec `!unpause` / `!ready`, ou par un admin) : sans alerte, elle peut
  durer sans que personne à l'organisation ne le voie.
* **Pistes** : un minuteur lancé au début de la pause technique (`PauseMatchService`, à côté des rappels périodiques « Pause
  technique … »), qui à 2 min publie une alerte vers les admins (le même canal que les appels admin et les alertes de la
  console : WebSocket `admin`) et la journalise ; durée réglable dans la configuration du tournoi (comme les autres
  délais) ; l'alerte s'annule à la reprise. Peut se répéter toutes les 2 min tant que la pause dure.
* **À décider** : le texte et l'endroit de l'alerte (bandeau de la console, tableau de bord, journal), et si les pauses
  « système » (restauration de round, pause posée par un admin) comptent aussi.

---

## ✅ Chantiers Achevés

- [x] **Correction des bugs latents (B-01, B-02, faux kills couteau)** : routage `matchId`, lecture de la `roundPhase` pour les pauses, filtrage des faux kills de map.
- [x] **Cycle de vie compétitif complet (MR12, mi-temps, overtime MR3)** : testé et validé sur scénario de 5 overtimes (53 rounds).
- [x] **Gestion des séries (Streaks) & Paliers économiques Valve** : calcul temps réel des séries de victoires/défaites et reset à la mi-temps et OT1.
- [x] **Scoreboard live en temps réel** : frags, morts, assists, flash-assists, headshots, poses, defuses et scores individuels avec tri dynamique.
- [x] **K/D/A identiques à CS2** (oracle `round_stats`) : mort par la C4 = 1 mort, suicide après déconnexion = 1 mort, teamkill sans −1 kill ; rollback des stats et séries sur restauration de backup.
- [x] **Golden Master sur 18 fixtures réelles + oracle CS2** : rejeu end-to-end de logs GGLan #18/#19 ; oracle en masse sur 44 matchs × 2 parsers (scores 88/88).
- [x] **Service Round Doctor natif Valve VDF** : génération et parsing de sauvegardes de round KeyValues VDF (`RoundBackupService`).
- [x] **Anonymisation stricte des fixtures** : suppression de toutes les données identifiantes réelles (pseudos, IP réelles, SteamID64, démos).
- [x] **Stack plug & play** : `Makefile` unique, tout sous Docker (`make up`, `make up-cs2` avec CS2 vanilla en conteneur, `make test`, `make replay`).
- [x] **Replay round par round dans la Sandbox** : suivant / précédent / aller au round N, barre de navigation avec le score CS2 de chaque round.
- [x] **Mi-temps et prolongations natives CS2** : GG-Core suit le serveur (plus de `mp_swapteams` / `mp_restartgame` en cours de match), `mp_maxrounds` / `mp_overtime_maxrounds` alignés sur les réglages, prolongations illimitées (`mp_overtime_limit 0`).
- [x] **Fin de match propre** : reset warmup différé (`postgameResetDelaySec`), démo GOTV (`tv_enable`), kick des joueurs restés connectés (`postgameKickDelaySec`, action agent `kick_all`) - besoin réel derrière l'ex-item « joueurs AFK en LAN ».
- [x] **Arbitrage du Game Over serveur** : score = serveur, verdict = règlement GG-Core ; en cas de désaccord résultat gelé + alerte admin, `POST /api/matches/:id/review/accept-server | dismiss`.
- [x] **Pauses** : armement pendant tout le round (y compris bombe posée / fin de round), banque tactique réglable par match (`tacticalPauseBankSec`, 120 s par défaut).
- [x] **Agent** : RCON ≤ 6 commandes/s sur une connexion réutilisée, plus aucune ligne de log perdue après un lancer de grenade (`Parse()` multi-événements).
- [x] **Historique git sans données réelles de joueurs** (réécriture `filter-repo` des fixtures, 2026-10-30).

- [x] **Message global aux serveurs au Buytime avec réarmement multi-rounds** (Item §15) : diffusion armée au freeze time sur N rounds consécutifs (`roundsCount`), envoi immédiat si serveur libre/warmup, réarmement et annulation via API REST `/admin/broadcasts`, suivi temps réel par serveur et persistance Redis.
- [x] **Personnalisation Admin des Commandes In-Game & Templates de Messages (Alias & i18n)** (Item §16) :
  - Stockage en PostgreSQL `JSONB` (`tournaments.settings.config`) avec fallback transparent sur valeurs par défaut.
  - Résolution dynamique de commandes in-game (`TournamentConfigService.resolveCommand`) traduisant tout alias personnalisé (`!sos`, `!temps`, etc.) vers son action canonique (`admin`, `pause`, etc.) et respectant les commandes désactivées (`disabledCommands`).
  - Système de templates de messages interpolés (`formatMessage` avec `{tag}`, `{message}`, `{team}`, `{player}`, `{round}`, etc.) pour personnaliser le tag du bot (`botTag`) et toutes les annonces CS2 chat.
  - API REST complète : `GET /api/tournament/config/defaults`, `GET /api/tournament/tournaments/:id/config`, `PUT .../config`, `POST .../config/reset`. Cache Redis invalidé à chaud.
