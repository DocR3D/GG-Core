# Backlog & TODOs - GG-Core

Ce fichier centralise les chantiers, fonctionnalités à venir, améliorations architecturales et tâches techniques identifiées pour atteindre le **MVP complet** de GG-Core (successeur moderne d'eBot pour CS2 en LAN).

---

## 🚀 Périmètre MVP Restant (Fonctionnalités Clés à Livrer)

Le cœur moteur de match, l'arbitrage automatisé, le calcul de scores/stats CS2 et le replay de logs sont opérationnels. Les chantiers ci-dessous constituent ce qui manque pour un tournoi LAN opérationnel de bout en bout :

### 1. 🖥️ Frontend Next.js (Admin, Spectateur, Joueur)
* **Origine & Spécifications** : [`docs/cahier-des-charges.md`](file:///d:/DEV/GG-Core/docs/cahier-des-charges.md) et [`docs/context/frontend.md`](file:///d:/DEV/GG-Core/docs/context/frontend.md).
* **État actuel** : Non implémenté. Seule l'interface temporaire de test Sandbox HTML est servie par NestJS.
* **Tâches à réaliser** :
  - **Initialisation** : Setup du projet Next.js (App Router, Tailwind CSS, shadcn/ui, client Socket.IO).
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
* **Origine** : Les modèles de données existent dans Prisma ([`backend/prisma/schema.prisma`](file:///d:/DEV/GG-Core/backend/prisma/schema.prisma)), mais il n'y a pas encore d'API REST pour les manipuler.
* **Tâches à réaliser** :
  - **Endpoints REST CRUD** :
    - Tournois : `POST /api/tournaments`, `GET /api/tournaments/:id`, `PATCH /api/tournaments/:id`.
    - Équipes & Joueurs : inscription, composition du roster (titulaires, remplaçants), association des SteamID.
    - Poules & Brackets : génération automatique des rencontres de poules (Round-Robin) et des arbres d'élimination directe/double (Playoffs).
  - **Liaison Match ➔ Tournoi** : avancement automatique du gagnant dans l'arbre lors du `postgame`.

### 3. 🗺️ Module de Vétos de Maps (Map Pick & Ban)
* **Fait** : pierre-feuille-ciseaux puis véto BO1 / BO3 / BO5 sur la page `/veto/:matchId` (capitaines connectés avec
  Steam, désignés par l'admin), mode de side knife ou pick par tournoi / phase, maps → games de la série, lancement sur
  la map et les sides du véto (`docs/context/backend.md`).
* **Reste** :
  - Import des capitaines par CSV (avec l'import des équipes, format à voir avec le dev du site d'inscription).
  - Minuteur par étape (ban aléatoire) : écarté pour l'instant, l'admin débloque à la main.
  - Le backend pousse `veto:updated` (WebSocket) ; la page de test s'en sert déjà pour se recharger, le futur front
    mettra l'écran à jour sans rechargement.
  - **Camps des joueurs en mode de side « pick »** (pas de knife, et zéro plugin : CS2 ne force personne dans un camp) :
    au passage en live, contrôle par les deux capitaines (SteamID connus grâce à la connexion Steam) : bon camp →
    lancement ; les deux inversés → `mp_swapteams` (natif) puis lancement ; sinon lancement bloqué + message chat
    (« Rouge doit jouer T ») + alerte admin ; joueurs nommés si leurs SteamID sont connus. Pas de kick. Noms d'équipe
    en jeu (`mp_teamname_1` / `mp_teamname_2`, à vérifier dans le dump des convars) posés **après** l'éventuel swap :
    on ne sait pas encore si `mp_swapteams` déplace les noms (RT-10). À faire avec les tests sur serveur (RT-09, RT-10).
  - **Front voulu** (la page `/veto/:matchId` actuelle n'est qu'un outil de test) : d'abord un écran
    pierre-feuille-ciseaux, puis un écran pick & ban où l'on clique sur l'image de chaque map. Images servies en local
    (LAN-first), à fournir. Garder séparés l'écran capitaine et l'écran admin (comme les pages de test `/veto/:id` et `/veto/:id/admin`) : un admin qui est aussi capitaine
    a cliqué pour l'adversaire pendant son tour (test du 2026-10-30, refus propre côté serveur).

### 4. 🔒 Sécurité des Accès Serveurs & Whitelist SteamID
* **Origine** : Protection des matchs LAN contre les intrusions ou erreurs de connexion.
* **Tâches à réaliser** :
  - **Mot de passe unique obligatoire** : génération d'un mot de passe aléatoire par match, injecté sur le serveur CS2 via RCON (`sv_password <password>`).
  - **Module de Whitelist SteamID** :
    - Vérification à l'événement `player_connected` ou `player_connect`.
    - Si le joueur n'appartient à aucune des deux équipes inscrites, émission d'une commande RCON pour le kicker (`kickid <userid> "Vous n'êtes pas inscrit sur ce match"`).
    - Option désactivable pour les matchs d'entraînement / tests.
    - Accepter **tout le roster** de l'équipe (titulaires **et remplaçants**), pas seulement les titulaires : les remplaçants jouent notamment les matchs bonus.

### 5. 🌐 Orchestration Dynamique de la Flotte de Serveurs (Multi-serveurs)
* **Origine** : Objectif de superviser jusqu'à 32 (ou 64) serveurs simultanément en LAN.
* **Tâches à réaliser** :
  - Cycle de vie des serveurs dans la base de données : `IDLE` ➔ `ASSIGNED` ➔ `BUSY` ➔ `RELEASED`.
  - Aiguilleur d'allocation : assignation automatique du premier serveur libre lors du passage d'un match en phase `warmup`.
  - Libération et réinitialisation automatique du serveur à la fin du match (`postgame`).

### 6. 🔑 Authentification & Gestion des Rôles (JWT)
* **Origine** : Sécurisation des accès d'arbitrage.
* **Tâches à réaliser** :
  - Authentification JWT pour les administrateurs et arbitres (rôles `ADMIN`, `REFEREE`, `SPECTATOR`).
  - Protection des routes d'administration REST et des commandes RCON.
  - Ségrégation des flux WebSocket Socket.IO : rooms `match:{id}:admin` (commandes, logs bruts, actions) vs `match:{id}:public` (scores, stats, rounds).

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

### 13. 🎥 Overlays OBS (score en direct sur le stream)
* **Besoin** : pages « source navigateur » pour OBS (score, prochain match, arbre, MVP de la map).
* **Prévu** : thème `overlay` (`backend/public/css/overlay.css` + `htmlPage({ theme: 'overlay' })`) : fond transparent,
  sans barre du site, 1920×1080 ; une adresse par serveur (`/overlay/server/:serverId/score`) qui suit le match en cours ;
  mise à jour par le WebSocket public, pas par rechargement (seule exception à « pages sans JS »).

### 14. 🎨 Page charte du design
* Une page qui montre tous les éléments (titres, tableaux, boutons, formulaires, bloc ASCII, classes du vocabulaire de
  `base.css`) dans les deux thèmes : l'équivalent léger d'un Storybook, pour juger une modification du CSS d'un coup d'œil.

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
