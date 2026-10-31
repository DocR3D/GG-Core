# GG-Core

Orchestrateur de tournois **Counter-Strike 2** pour LAN et compétitions (successeur d'eBot).
Contrôle des matchs (knife, swap, pauses, overtime), collecte des événements, API REST + WebSocket, et interfaces live.
**Zero plugin** : le serveur CS2 ne communique qu'en RCON natif et `logaddress_add_http`.

---

## Technologies

- **Agent** : Go (RCON, ingestion des logs HTTP, parsing)
- **Backend** : NestJS (TypeScript), Socket.IO
- **Base de données** : PostgreSQL 16 + Prisma (event sourcing, tournois)
- **Cache / Bus temps réel** : Redis 7
- **Frontend** : Next.js *(à venir - en attendant, une console Sandbox est servie par le backend)*
- **Conteneurisation** : Docker + Docker Compose

Prévu : analyse CSTV/GOTV (positions, grenades), replays mini-map.

---

## Démarrage rapide

### Prérequis
- **Docker + Docker Compose v2** - c'est tout (ni Node ni Go à installer : tout tourne en conteneurs).
- Linux / macOS : `make`. Windows : WSL2 avec Docker dans WSL (ou Docker Desktop), et `make` dans WSL (`sudo apt install make`).
- Si `docker` exige `sudo` : `sudo usermod -aG docker $USER` puis rouvrir le terminal.

### Lancer le projet
```bash
git clone https://github.com/DocR3D/GG-Core.git
cd GG-Core
make            # liste des commandes
make doctor     # vérifie Docker, droits, espace disque
make up         # Redis + PostgreSQL + backend + agent Go (schéma de base appliqué automatiquement)
make up-cs2     # idem + serveur CS2 dédié vanilla en conteneur (~73 Go téléchargés au 1er lancement)
make replay F=gglan19_mirage_13-11_anonymized.log   # rejoue un vrai match dans la Sandbox
make test       # typecheck + Jest + intégration PostgreSQL + Go
make e2e-tournament   # scénario tournoi complet sur la stack lancée (vue ASCII à relire)
make down       # arrêt (données conservées)
```

Sous Windows : lancer ces commandes depuis un terminal WSL, dans le dépôt (ex. `cd /mnt/d/DEV/GG-Core`).
- WSL s'arrête quand plus aucun terminal WSL n'est ouvert (et Docker avec lui) : garder un terminal WSL ouvert pendant les tests. Les conteneurs redémarrent seuls à la réouverture.
- Les données Docker (dont les ~73 Go de CS2) vivent dans le disque virtuel de WSL, **sur C: par défaut**. Si C: est petit, déplacer la distribution avant `make up-cs2` : `wsl --shutdown` puis `wsl --manage Debian --move D:\WSL\Debian`.

- Backend (REST) : http://localhost:8081/api (health : `/api/health`)
- WebSocket : ws://localhost:8081
- Console Sandbox (rejeu de logs, injection d'état, RCON) : http://localhost:8081/sandbox
- Serveur CS2 conteneurisé : `connect localhost:27015` (mot de passe RCON : `make status`)

### Serveurs CS2 de la LAN
Une commande par serveur, depuis la machine GG-Core :

```bash
make server NAME=srv-b IP=10.0.0.12            # [PORT=27015] [LAN_IP=<IP de cette machine sur la LAN>]
```

Elle crée l'agent du serveur (`agents.d/srv-b.yaml`, port de logs suivant : 8083, 8084… jusqu'à 32 serveurs), enregistre
le serveur dans le tournoi, affiche les lignes à coller dans la config du serveur CS2 (`rcon_password`, `log on`,
`logaddress_add_http` avec le bon port et le bon jeton) et vérifie la connexion RCON. Ensuite, et avant la LAN :

```bash
make servers    # pour chaque serveur : libre / occupé, RCON connecté, derniers logs reçus, jeton refusé
```

Les secrets restent dans `.env` (aucun mot de passe dans `agents.d/`). Retirer un serveur : supprimer son fichier
`agents.d/<nom>.yaml` (l'agent s'arrête dans les 5 s) et le désactiver dans le tournoi
(`POST /api/tournament/servers/<nom>/disable`). Sous WSL, les serveurs de la LAN ne voient pas la VM : donner
`LAN_IP` = l'IP de Windows et rendre les ports de logs joignables (réseau « mirrored » de WSL, ou `netsh interface portproxy`).

Les logs CS2 vont à l'**agent Go** du serveur, qui les parse puis les transmet au backend.
> ⚠️ Ne pas pointer CS2 directement vers le backend (`/cs2/logs`) : cet endpoint attend des événements **JSON déjà parsés** par l'agent et rejette les lignes de log brutes (HTTP 400).

---

### Connexion et droits
- **Secrets générés automatiquement** : au premier `make`, le fichier `.env` (ignoré par git) est créé avec des valeurs
  **aléatoires** (session, mot de passe admin, jeton admin, jeton des logs CS2, mot de passe RCON) ; ensuite il est
  réutilisé, jamais écrasé. Aucune valeur par défaut publique : la stack refuse de démarrer sans lui. `make admin` affiche
  l'URL de connexion et le mot de passe admin.
- **Lecture publique** : `/view` (tournois, arbres, matchs) et les `GET` de `/api`.
- **Admin** pour tout ce qui modifie (`POST` / `PATCH` / `DELETE`) et pour le Sandbox : connexion sur
  **http://localhost:8081/login** avec **« Se connecter avec Steam »** (mets ton SteamID64 dans `GG_ADMIN_STEAMIDS` du
  `.env`, ou `GG_ADMIN_STEAMIDS=<id> make up`) ou, sans Internet, avec le **mot de passe admin** (`make admin`).
- **Scripts / curl** : `-H "Authorization: Bearer <GG_ADMIN_TOKEN du .env>"` (les cibles `make` le font).

## Structure du dépôt
```
/agent       # Go : agent (RCON, logs HTTP, parser) + manager (1 agent par serveur)
/agents.d    # Config YAML d'un agent par serveur CS2
/backend     # NestJS : moteur de match, API REST, WebSocket, Sandbox
/infra       # Docker Compose (dev, ci, monolith)
/docs        # Cahier des charges, architecture, contexte technique
/test        # Fixtures (logs CS2 réels anonymisés, scénarios, backups)
```

---

## Docs
- [Architecture détaillée](./docs/architecture.md)
- [Cahier des charges](./docs/cahier-des-charges.md)
- [Contexte technique (agent, backend, frontend, infra)](./docs/context/docs-index.md)
- [Backlog MVP](./docs/context/todo.md)
- [Cas de test](./docs/test-cases.md)
- [Guide agents IA / contributeurs](./AGENTS.md)
