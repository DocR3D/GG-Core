# GG-Core - Agent Guidelines & Architecture Reference

Ce fichier sert de point d'entrée universel pour tout agent d'intelligence artificielle ou développeur intervenant sur **GG-Core** (successeur moderne d'eBot pour Counter-Strike 2).

---

## 📌 1. Vue d'ensemble du Projet

**GG-Core** est un gestionnaire et orchestrateur distribué de matchs CS2 pour tournois LAN (ex: GG-Lan à Brest) et compétitions en ligne.

### Les 5 Piliers d'Architecture :
1. **Agent Go** (`agent/`) : Collecte les logs HTTP CS2 (`logaddress_add_http`) et exécute les commandes RCON via une file d'attente fiabilisée. Supervisé par un **Manager Go**.
2. **Backend NestJS** (`backend/`) : Cœur métier en Clean Architecture, machine à états, gestion des règles, API REST et serveur WebSocket (Socket.IO).
3. **Redis** : Bus de messages temps réel (Pub/Sub) et cache d'état actif (snapshots de match).
4. **PostgreSQL** : Source of Truth historique (Sourcing d'événements, tables `events_primary`, tournois, équipes, joueurs).
5. **Frontend Next.js** (`frontend/`, pas encore créé) : Interfaces réactives pour administrateurs (console live), spectateurs (scoreboard) et joueurs. En attendant, le backend sert des pages HTML simples (`/view`, `/veto`, `/login`, `/sandbox`) stylées par `backend/public/css/`.

---

## 📚 2. Documentation de Contexte Détaillée

Pour toute tâche d'envergure, consulter les fiches techniques dans `docs/` et `docs/context/` :
- `docs/cahier-des-charges.md` : Cahier des charges complet (version Markdown intégrale).
- `docs/architecture-multi-jeux.md` : **Architecture cible** - MVP = tournoi CS2 complet sans Toornament ; tables d'arbre génériques, concepts CS dans des tables CS ; ce qu'on fait maintenant vs plus tard (multi-jeux, tunnel, export). À lire avant de toucher aux équipes / arbres / pages.
- `docs/context/agent-go.md` : Structure Go, managers, parsing regex, protocoles RCON.
- `docs/context/backend.md` : Découpage NestJS (Domain, Application, Adapters), subscribers, état Redis.
- `docs/context/frontend.md` : Spécifications UI, abonnements WebSocket, rôles JWT.
- `docs/context/infra.md` : Configuration Docker Compose, variables d'environnement, réseau LAN.
- `docs/context/docs-index.md` : Résumé du cahier des charges et index documentaire.
- `docs/test-cases.md` : Scénarios de tests (TC-01 à TC-09) et tests sur serveur CS2 réel (validés + **en suspens RT-01 à RT-08**).

---

## ⚙️ 3. Fiche Technique Rapide (Quick Reference)

### Stack Technologique
- **Agent** : Go 1.23+ (`gorcon/rcon`, `redis/go-redis/v9`, `fsnotify`).
- **Backend** : NestJS v10 (TypeScript), Socket.IO, `ioredis`.
- **Infra** : Docker Compose, Redis 7 Alpine, PostgreSQL.

### Alias TypeScript (Backend)
- `@domain` ➔ `src/domain` (Événements purs, contrats de règles)
- `@app` ➔ `src/application` (Cas d'usage, machine à états, orchestrateur)
- `@adapters` ➔ `src/adapters` (HTTP, WebSockets, connecteurs Redis)

### Ports Réseau Critiques
- **RCON CS2** : `27015/tcp`
- **Backend API REST & WebSocket** : `8081` (`/api`, `/ws`)
- **Agents HTTP Logs** : `8082+` (un port d'écoute distinct par serveur CS2)
- **Redis** : `6379`
- **PostgreSQL** : `5432`

### Clés Redis Essentielles
- `match:{id}:phase` : Phase globale courante du match (`MatchPhase`).
- `match:{id}:roundPhase` : Phase interne du round courant (`RoundPhase` - **attention : clé séparée !**).
- `ggbot:events` : Canal Pub/Sub principal de distribution des événements de jeu.
- `ggbot:agent:{serverId}:actions` : Canal de commande RCON vers l'agent spécifique.
- `server:{serverId}:currentMatch` : Liaison d'identité serveur ➔ matchId.
- `match:{id}:review` : Résultat gelé quand le `Game Over` du serveur contredit GG-Core (en attente d'arbitrage admin).

### Cycle de Vie d'un Match (Phases)
```
warmup_knife ➔ knife_live ➔ knife_choice ➔ warmup_main ➔ live_main ➔ half_time ➔ overtime ➔ postgame
```

---

## 🛡️ 4. Règles d'Or & Contraintes Non Négociables

1. **Règle « Zero Plugin »** :
   Interdiction formelle d'ajouter des plugins serveurs (pas de SourceMod, Metamod, etc.). Le serveur CS2 ne communique qu'à travers **RCON natif** et **`logaddress_add_http`**.
2. **Priorité LAN-First** :
   Aucun composant critique ne doit dépendre d'une connexion Internet externe.
3. **Protection RCON** :
   Toujours respecter le rate-limiting RCON (maximum 6 requêtes/seconde par serveur) pour ne jamais geler le serveur de jeu.
4. **Intégrité de la Persistance** :
   L'événement est l'unité atomique. Les données de scores et victoires de rounds doivent être immuables et résilientes aux redémarrages.

---

## 🌐 5. Sources Officielles Valve & Anti-Hallucination

Pour garantir une fidélité absolue et **ne jamais halluciner** de commande RCON inexistante ou de règle compétitive erronée, l'agent doit se référer à ces sources de vérité à jour :

1. **Base de données des commandes & Convars CS2 (Total CS)** :  
   👉 [Total CS:GO & CS2 Commands Database](https://totalcsgo.com/commands)  
   *Consigne : Référence pratique et à jour pour vérifier la syntaxe exacte, les valeurs par défaut, la description et si `sv_cheats` est requis (ex: `tv_secure_bypass`, `mp_pause_match`, etc.).*

2. **Dump binaire brut CS2 à jour de chaque patch (SteamDB / GameTracking)** :  
   👉 [SteamTracking GameTracking-CS2 Convars Dump](https://github.com/SteamTracking/GameTracking-CS2/blob/master/DumpSource2/convars.txt)  
   *Consigne : Source of Truth absolue extraite directement des binaires du jeu par SteamDB lors de chaque mise à jour CS2 de Valve.*

3. **Règlement officiel des compétitions Valve (Major Supplemental Rulebook)** :  
   👉 [Valve GitHub: Major Supplemental Rulebook](https://github.com/ValveSoftware/counter-strike_rules_and_regs/blob/main/major-supplemental-rulebook.md)  
   *Consigne impérative : Référence absolue pour les règles compétitives (format MR12, overtime MR3, nombre et durée des pauses tactiques, pauses techniques, déconnexions de joueurs).*

---

## 🧪 6. Commandes de Validation

Avant de considérer une tâche comme achevée, toujours valider la non-régression :
```bash
# Backend NestJS
cd backend
npm run typecheck    # Vérification stricte des types TypeScript (tsc --noEmit)
npm run build        # Compilation complète NestJS
npm test             # Suite Jest complète (dont Golden Master sur fixtures réelles)

# Intégration PostgreSQL réelle (base à jour via `npx prisma db push`) - obligatoire si la persistance change
DB_IT=1 npx jest --config jest.config.ts db.spec   # tous les *.db.spec.ts (ou : make test-db)

# Agent Go
cd agent
go build ./cmd/agent
go build ./cmd/manager
go test ./...

# Scénario tournoi de bout en bout (stack lancée : make up) - obligatoire si le tournoi / le lancement des matchs change
make e2e-tournament
```

- **Golden Master** (`fixtures-golden-master.spec.ts`) : ne régénérer `test/fixtures/expected-outcomes.json` (`UPDATE_GOLDEN=1`) qu'après un changement de comportement **voulu**, et relire le diff avant de commiter.
- Les specs unitaires mockent Prisma : elles ne détectent pas les erreurs de types de colonnes (UUID, FK). D'où le test `event-sourcing.db`.

---

## 🧠 7. Protocole Memory Bank (Carnet Local)

Si un répertoire `memory-bank/` est présent localement sur le poste de travail :
- L'agent doit le consulter au début de chaque session pour connaître le focus actuel (`activeContext.md`) et l'avancement (`progress.md`).
- L'agent doit auto-mettre à jour ces fichiers à la fin de chaque étape significative.
