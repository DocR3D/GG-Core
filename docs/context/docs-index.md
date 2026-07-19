# Documentation — Index

## Fichiers existants

| Fichier | Contenu |
|---------|---------|
| `docs/architecture.md` | Schéma global, rôles composants, flux de données, contraintes réseau |
| `docs/Cahier des Charges eBot.pdf` | Cahier des charges complet (33 pages) |
| `docs/ebot-reference.md` | Référence du projet d'origine (eBot-CSGO) : relation serveur CS ↔ eBot, RCON, parsing logs, comparaison avec GG-Core |
| `docs/test-cases.md` | Cas de test dérivés de logs réels + bugs connus (B-01, B-02) |
| `docs/plans/admin-actions-api.md` | Plan de conception de l'API admin-actions — **implémenté**, conservé comme référence |
| `docs/context/agent-go.md` | Contexte Agent Go (binaires, endpoints HTTP, canal Redis, fichiers .cfg) |
| `docs/context/backend.md` | Contexte Backend NestJS (Domain/Application/Adapters, Postgres, tournois, séries) |
| `docs/context/frontend.md` | Contexte Frontend (non implémenté à ce jour) |
| `docs/context/infra.md` | Contexte Infrastructure (ports, Docker Compose, PostgreSQL, déploiement LAN) |
| `README.md` | README racine |
| `backend/README.md` | README backend NestJS (inclut config du mappool `config/maps.json`) |

## Résumé du cahier des charges

### Contexte
GG-Core remplace eBot pour CS2. Conçu pour les tournois LAN (GG-Lan à Brest).
- Sans plugin SourceMod (RCON + logaddress_add_http uniquement)
- Multi-serveurs (jusqu'à 32)
- LAN-first (zéro dépendance Internet)

### Fonctionnalités v1 (périmètre inclus)
- Gestion tournois : poules, brackets, vétos, matchs
- Contrôle serveurs : start, pause, knife, swap, overtime
- Stats : kills, deaths, assists, HS%, K/D, économie
- Pauses tactiques (auto-unpause) et techniques
- Accès : mot de passe unique + whitelist SteamID optionnelle
- Interfaces : Admin, Joueur, Public
- Export JSON/CSV

### Hors périmètre v1
- Overlays stream
- Replay 2D / GOTV viewer
- Eco kill, dégâts par round, entry kill

### Scénarios de validation
1. 10 serveurs simultanés sans perte d'événements
2. Redémarrage backend : reprise depuis snapshots
3. Pause tactique + auto-unpause
4. Crash agent : reconnexion sans perte de contrôle
5. Crash server CS : backup depuis snapshot

## État d'avancement réel vs cahier des charges (dernière vérification code)

| Fonctionnalité | État |
|---|---|
| Contrôle serveur (pause/unpause/knife/swap/overtime) | Implémenté (`admin-actions.controller.ts`, agent `/admin-action`) |
| Gestion multi-serveurs (CRUD + probe de statut) | Implémenté (`servers.controller.ts`, `server-probe.service.ts`) — non testé à grande échelle (32 serveurs) |
| Séries Bo1/Bo3/Bo5 | Implémenté (`series-create.controller.ts`, `series-state.service.ts`) |
| Sync tournois/équipes depuis API externe | Implémenté (`tournament-sync.service.ts`) |
| Persistance PostgreSQL (matchs, historique, séries, serveurs) | Implémenté (`adapters/postgres/`) |
| Interface Admin/Public/Joueur (frontend) | **Non implémenté** — aucun dossier `frontend/` |
| Endpoint équipes réel (hors mock) | **Mock** — `teams.controller.ts` renvoie une liste statique |
| Export JSON/CSV | Non vérifié dans le code actuel |
| Whitelist SteamID | Non vérifié dans le code actuel |
