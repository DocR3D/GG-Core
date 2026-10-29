# Backlog & TODOs — GG-Core

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
* **Origine** : Workflow standard de compétition CS2 avant le chargement du serveur.
* **Tâches à réaliser** :
  - Machine à états pour les formats de match : **BO1**, **BO3** et **BO5**.
  - Déroulement tour par tour : ban alterné des maps, sélection des maps jouées, choix de la carte décisive (*decider*) et choix du camp de départ (*side pick*).
  - Événements WebSocket en temps réel pour synchroniser le véto entre capitaines et spectateurs.
  - Initialisation automatique du match sur le serveur avec la première map issue du véto.

### 4. 🔒 Sécurité des Accès Serveurs & Whitelist SteamID
* **Origine** : Protection des matchs LAN contre les intrusions ou erreurs de connexion.
* **Tâches à réaliser** :
  - **Mot de passe unique obligatoire** : génération d'un mot de passe aléatoire par match, injecté sur le serveur CS2 via RCON (`sv_password <password>`).
  - **Module de Whitelist SteamID** :
    - Vérification à l'événement `player_connected` ou `player_connect`.
    - Si le joueur n'appartient à aucune des deux équipes inscrites, émission d'une commande RCON pour le kicker (`kickid <userid> "Vous n'êtes pas inscrit sur ce match"`).
    - Option désactivable pour les matchs d'entraînement / tests.

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

### 8. ⏯️ Mode « round par round » dans la simulation (Sandbox)
* **Origine** : La simulation actuelle ([`sandbox.service.ts`](file:///d:/DEV/GG-Core/backend/src/application/match/sandbox/sandbox.service.ts), replay de logs bruts ou scénarios JSON) rejoue tout le match d'un bloc.
* **Besoin** : Pouvoir avancer le replay un round à la fois (bouton « Round suivant ») : rejouer les événements jusqu'au prochain `Round_End` / `team_round_win`, puis marquer une pause pour inspecter le snapshot (score, K/D/A, streaks, économie, phase).
* **Pistes d'implémentation** :
  - Option `mode: 'round-by-round'` avec curseur d'index par match.
  - Endpoint `POST /sandbox/replay/next-round` (et retour arrière en réinitialisant puis rejouant jusqu'au round N-1).
  - Test Jest validant l'égalité stricte entre replay round-par-round et replay complet.

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

---

## ✅ Chantiers Achevés

- [x] **Correction des bugs latents (B-01, B-02, faux kills couteau)** : routage `matchId`, lecture de la `roundPhase` pour les pauses, filtrage des faux kills de map.
- [x] **Cycle de vie compétitif complet (MR12, mi-temps, overtime MR3)** : testé et validé sur scénario de 5 overtimes (53 rounds).
- [x] **Gestion des séries (Streaks) & Paliers économiques Valve** : calcul temps réel des séries de victoires/défaites et reset à la mi-temps et OT1.
- [x] **Scoreboard live en temps réel** : frags, morts, assists, flash-assists, headshots, poses, defuses et scores individuels avec tri dynamique.
- [x] **Règles CS2 K/D fidèles aux serveurs officiels** : exclusion des suicides de déconnexion et de souffle de bombe C4, pénalisation des teamkills (`-1 kill`, `-2 score`).
- [x] **Suite de tests Golden Master sur 11 fixtures réelles** : rejeu end-to-end de logs réels de la GGLan #19 sans dépendance à un serveur CS2 physique.
- [x] **Service Round Doctor natif Valve VDF** : génération et parsing de sauvegardes de round KeyValues VDF (`RoundBackupService`).
- [x] **Anonymisation stricte des fixtures** : suppression de toutes les données identifiantes réelles (pseudos, IP réelles, SteamID64, démos).
