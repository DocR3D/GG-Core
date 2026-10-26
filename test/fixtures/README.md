# Test Fixtures & Datasets — GG-Core

Ce dossier centralise les jeux de données réels et synthétiques servant à tester et valider l'ensemble du système GG-Core (Agent Go, Backend NestJS, Frontend).

---

## 📂 Structure du dossier

```
test/fixtures/
├── raw-logs/     # Fichiers de logs bruts (.log, .txt) issus des serveurs CS2
├── demos/        # Fichiers de démos de match (.dem) — exclus de Git (lourds)
└── scenarios/    # Événements JSON chronologiques normalisés (consommables par Jest)
```

---

## 📁 1. `raw-logs/` (Logs bruts CS2)
- **Format** : Fichiers texte générés par CS2 (`logaddress_add_http` ou console serveur).
- **Usage** :
  - Validation du parser regex Go (`agent/internal/parser/parser.go`).
  - Détection de régressions sur de nouvelles versions de CS2.
- **Convention de nommage** : `YYYY-MM-DD_<map>_<type-match>.log`  
  *(Exemple : `2026-03-08_de_inferno_knife-to-live.log`)*

---

## 📁 2. `demos/` (Fichiers `.dem`)
- **Format** : Fichiers binaires de démos CS2 (Source 2 CSTV / GOTV).
- **⚠️ Important** : Les fichiers `*.dem` pèsent généralement entre 50 et 200 Mo. Ils sont **automatiquement ignorés par `.gitignore`** pour ne pas alourdir le dépôt GitHub.
- **Usage** :
  - Extraction de la timeline complète via scripts de parsing.
  - Télémétrie future (grenades, heatmaps, positions).

---

## 📁 3. `scenarios/` (Scénarios d'événements JSON)
- **Format** : JSON structuré représentant le flux chronologique d'un match (tableaux d'événements `AnyEvent`).
- **Usage** :
  - Replay déterministe dans les tests unitaires et d'intégration Jest.
  - Simulation de matchs de bout en bout sans avoir besoin d'allumer un vrai serveur CS2.
- **Convention de nommage** : `scenario-<numero>-<description>.json`  
  *(Exemple : `scenario-01-full-knife-flow.json`)*
