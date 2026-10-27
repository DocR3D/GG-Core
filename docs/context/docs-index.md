# Documentation — Index

## Fichiers existants

| Fichier | Contenu |
|---------|---------|
| `docs/architecture.md` | Schéma global, rôles composants, flux de données, contraintes réseau |
| `docs/cahier-des-charges.md` | Cahier des charges complet (version Markdown) |
| `docs/Cahier des Charges eBot.pdf` | Cahier des charges complet (version PDF originale) |
| [Total CS2 Commands](https://totalcsgo.com/commands) | Base de données des commandes et convars CS2 à jour |
| [SteamTracking CS2 Convars](https://github.com/SteamTracking/GameTracking-CS2/blob/master/DumpSource2/convars.txt) | Dump officiel des convars extrait directement des binaires du jeu (SteamDB) |
| [Valve Major Rulebook](https://github.com/ValveSoftware/counter-strike_rules_and_regs/blob/main/major-supplemental-rulebook.md) | Règlement officiel des tournois et compétitions Valve |
| `docs/context/agent-go.md` | Contexte Agent Go |
| `docs/context/backend.md` | Contexte Backend NestJS |
| `docs/context/frontend.md` | Contexte Frontend (prévu) |
| `docs/context/infra.md` | Contexte Infrastructure |
| `README.md` | README racine |
| `backend/README.md` | README backend NestJS |
| `docs/context/todo.md` | Backlog, roadmap MVP et tâches techniques restantes |

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
