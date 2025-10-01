# Architecture eBot++

##  Vue d’ensemble

Le système est composé de plusieurs services communicants, organisés autour d’un bus temps réel (**Redis**).  
Chaque service a une responsabilité claire : collecte, orchestration, stockage ou diffusion.

---

##  Schéma global

                     ┌─────────────────────┐
                     │     Manager Go      │
                     │   (orchestrateur)   │
                     └─────────┬───────────┘
                               │
        ┌──────────────────────┴───────────────────────┐
        │                                              │
┌───────▼───────┐                              ┌───────▼───────┐
│   Agent Go    │                              │   Agent Go    │
│  (Server #1)  │                              │  (Server #2)  │
│  RCON + Logs  │                              │  RCON + Logs  │
└───────┬───────┘                              └───────┬───────┘
        │                                              │
        └──────────────────┬───────────────────────────┘
                           │  Pub/Sub events
                           ▼
                     ┌──────────────┐
                     │    Redis     │
                     │ (bus temps   │
                     │   réel)      │
                     └───────┬──────┘
                             │
                             ▼
               ┌────────────────────────────┐
               │       Backend NestJS       │
               │   (état + API + WebSocket) │
               └───────────┬────────────────┘
                           │
        ┌──────────────────┴─────────────────────┐
        │                                        │
┌───────▼────────────┐                  ┌────────▼────────┐
│    PostgreSQL      │                  │ Frontend Next.js│
│ (historique, SOoT) │                  │   (live + admin)│
│ events_primary/    │                  └─────────────────┘
│ events_secondary   │
└────────────────────┘

SOoT = Source of Truth historique (vérité absolue).

---

##  Rôles des composants

###  Agent Go
- Connexion RCON (`pause`, `unpause`, `say`, `restart`, etc.)
- Réception des logs via `logaddress_add_http`
- Publication d’événements dans Redis
- **Prévu** : lecture du flux CSTV/GOTV (positions, grenades, stats avancées) — https://github.com/FlowingSPDG/gotv-plus-go

### ⚙ Backend NestJS
- Consomme les événements Redis
- Gère l’état des matchs/tournois (score, phases, pauses, économie)
- Expose une **API REST** (`/api/...`)
- Diffuse un flux **WebSocket** vers le frontend

###  PostgreSQL *(pas encore fait)*
- Base de données relationnelle pour l’historique (vérité absolue) :
  - Tournois, équipes, joueurs
  - Matchs, rounds, stats
  - **`events_primary` / `events_secondary`** pour rejouer/réconstruire l’état

###  Redis
- Sert de **bus temps réel** (Pub/Sub, éventuellement Streams)
- Découple les services (Agent ↔ Backend ↔ Frontend)

###  Frontend Next.js *(pas encore fait)*
- Application web publique : live scoreboard, overlays, mini‑map
- Console admin pour l’organisation (contrôle des matchs)

---

##  Flux d’information

1. **Logs/RCON** depuis le serveur CS2 → Agent Go  
2. **Agent Go** → Redis (publication d’événements)  
3. **Backend NestJS** → consommation Redis + mise à jour de l’état en mémoire / cache  
4. **Backend NestJS** → WebSocket (push vers frontend)  
5. **Frontend** → rendu live (scoreboard, mini‑map), commandes admin  
6. **Backend** → PostgreSQL (persistance des événements / historique)  

---

##  Contraintes & Rappels

- Côté serveurs CS2, seules les commandes suivantes sont nécessaires :  
  `rcon_password 123456` et `logaddress_add_http "http://<BACKEND_HOST>:8081/cs2/logs"`
- **PostgreSQL `events_*` = vérité absolue**. Redis est éphémère/temps réel.
- Manager Go crée 1 **agent** par serveur CS2 et les supervise.
