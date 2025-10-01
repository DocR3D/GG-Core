# eBot++

Orchestrateur de tournois **Counter-Strike 2** pour LAN et compétitions.  
Contrôle des matchs (knife, swap, pauses, OT), collecte des événements, API + WebSocket, et front public en direct.

---

## 🛠️ Technologies

- **Backend** : NestJS (TypeScript)
- **Frontend** : Next.js (React)
- **Agent** : Go (RCON, logs HTTP, CSTV prévu)
- **Base de données** : PostgreSQL
- **Cache / Bus temps réel** : Redis
- **Conteneurisation** : Docker + Docker Compose

Prévu :
- Analyse CSTV/GOTV pour la télémétrie (positions, grenades)
- Génération de replays mini-map

---

## 🚀 Démarrage rapide

### Prérequis
- Docker + Docker Compose
- `git`

### Installation
```bash
git clone https://github.com/ton-compte/ebot-plus.git
cd ebot-plus
cp .env.example .env
docker compose up -d
```

- Frontend : http://localhost:3000  
- Backend (REST) : http://localhost:8081/api  
- WebSocket : ws://localhost:8081

### Configuration serveur CS2
Ajoutez dans votre config serveur :

```
rcon_password 123456
logaddress_add_http "http://<BACKEND_HOST>:8081/cs2/logs"
```

---

## 📁 Structure du dépôt
```
/agent       # Go: RCON, logs HTTP, (CSTV optionnel)
/backend     # NestJS: API, état des matchs, WS
/frontend    # Next.js: live public + console admin
/infra       # Docker Compose, scripts
/docs        # Architecture, lifecycle, événements, guide admin
```

---

## 📚 Docs
- [Architecture détaillée](./docs/architecture.md)
- `docs/match_lifecycle.md` – phases & règles
- `docs/events.md` – formats d’événements (Redis/WS)
- `docs/admin-guide.md` – guide LAN (non-dev)
