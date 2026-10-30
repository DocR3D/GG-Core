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

---

## 🧪 4. Golden Master & Oracle CS2

Spec : `backend/src/application/match/sandbox/fixtures-golden-master.spec.ts`.

- **Golden Master** : chaque fichier de `raw-logs/` et `scenarios/` est rejoué et comparé à `expected-outcomes.json` (score, phase, sides, streaks, K/D/A/HS/score par joueur). Tout fichier ajouté doit y être enregistré (test dédié).
  - Régénérer **uniquement après un changement voulu** : `UPDATE_GOLDEN=1 npx jest --config jest.config.ts fixtures-golden-master`, puis relire le diff JSON (les entrées existantes ne doivent changer que si c'est attendu).
  - ⚠️ Le Golden Master fige le comportement **actuel** de GG-Core, il ne prouve pas qu'il est juste.
- **Oracle CS2** : pour les logs bruts qui contiennent les blocs `JSON_BEGIN … "round_stats" … JSON_END` émis par CS2, GG-Core est comparé à la **vérité du jeu** :
  - score final = ligne `Game Over: … score CT:T` ;
  - score et K/D/A par joueur = dernier bloc `round_stats` non vide (CS2 l'émet quelques secondes après chaque fin de round ; celui d'après `Game Over` est déjà remis à zéro).
  - Les écarts connus sont listés dans `KNOWN_ORACLE_GAPS` (tests `it.failing`) : retirer l'entrée dès que GG-Core est corrigé.

## 🔒 5. Ajouter une fixture depuis un log serveur réel

Les outils sont dans `scripts/` (locaux, non versionnés) :

```bash
# 1. Repérer les matchs complets d'un dossier de logs (aucune donnée personnelle affichée)
node scripts/inventory-logs.mjs "<dossier Logs_Serveurs_CS2>"

# 2. Extraire + anonymiser UN match (refuse d'écrire s'il reste un pseudo / ID / équipe / IP d'origine)
node scripts/make-fixture.mjs <log source> <map> <scoreCT> <scoreT> test/fixtures/raw-logs/<nom>_anonymized.log

# 3. Contrôle indépendant
node scripts/audit-fixtures.mjs test/fixtures/raw-logs/<nom>_anonymized.log

# 4. Enregistrer dans le Golden Master puis relire le diff de expected-outcomes.json
cd backend && UPDATE_GOLDEN=1 npx jest --config jest.config.ts fixtures-golden-master
```

Règles d'anonymisation (liste blanche) : seules les lignes de log de jeu (`L date - heure:`) de formes connues sont gardées ; **pas** de lignes `rcon from` (rapports de dégâts eBot nominatifs), de bruit moteur (`[SV CommandQueue]`, `[SteamNetSockets]` avec SteamID/IP), d'`ACCOLADE`, ni de chat libre (seules les commandes `!xxx` restent). Joueurs → `Player_NN` / `[U:1:100000NN]` (y compris les `accountid` des `round_stats`), équipes → `Team Alpha` / `Team Bravo`, nom d'hôte JSON → `GG-Core fixture`, adresses → `10.0.0.1`.

## 🧪 6. Oracle CS2 en masse (logs réels locaux, jamais commités)

Pour valider GG-Core sur **tous** les matchs d'une LAN (et pas seulement les fixtures commitées), via les **deux** parsers :

```bash
# 1. extraire + anonymiser chaque match complet d'un dossier de logs (local)
node scripts/bulk-extract.mjs "<Logs_Serveurs_CS2>" <bulk_dir> scripts/make-fixture.mjs
# (le script écarte lui-même les extraits non fiables : match commencé en cours de route (rotation de log) ou plusieurs serveurs
# entremêlés dans le même fichier (plusieurs Match_Start) — la vérité CS2 ne correspond plus au segment)

# 2. faire parser chaque log par le parser Go de l'agent (un appel TryParse par ligne, comme l'agent)
cd agent && BULK_DUMP_DIR=<bulk_dir> go test ./internal/parser -run TestBulkDump -count=1

# 3. oracle : score + K/D/A de chaque joueur vs round_stats, parser de secours ET parser Go
cd backend && BULK_ORACLE_DIR=<bulk_dir> npx jest --config jest.config.ts fixtures-golden-master -t "Bulk"
```

Résultat GGLan #19 (2026-10-29) : 44 matchs propres × 2 parsers → scores 88/88, K/D/A identiques sur 43/44 ; le seul écart
est 1 assist que CS2 compte sans qu'aucune ligne `assisted killing` n'apparaisse dans le log. Parser Go = parser de secours sur 44/44.

## Tournois fictifs (`tournaments/`)

Scénarios de tournoi joués par l'API (`make tournament F=fake-gglan-32.json`) : équipes, phases, qualification et règle de
résultats **déterministe** (le meilleur seed gagne, avec des surprises tirées d'un générateur à graine fixe : même fichier =
même tournoi). Données inventées, aucune donnée réelle. La double élimination n'étant pas encore jouable, le scénario
s'arrête à la qualification.
