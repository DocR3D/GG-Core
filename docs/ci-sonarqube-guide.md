# Guide de mise en place : CI & SonarQube (Backend GG-Core)

Ce guide détaille la mise en œuvre de l'intégration continue (CI) et de l'analyse de qualité statique SonarQube / SonarCloud pour le backend NestJS de GG-Core.

---

## 🚀 1. Commandes Locales (« Shift Left »)

Avant de pousser du code, les développeurs peuvent exécuter localement la vérification complète :

```bash
# Via Docker (sans rien installer)
make check

# Ou directement dans le dossier backend/
cd backend
npm run check    # Exécute typecheck + lint + test:coverage
```

Cette commande exécute séquentiellement :
1. `npm run typecheck` (`tsc --noEmit`) : validation stricte des types TypeScript sur le code source ET les fichiers de tests.
2. `npm run lint` (ESLint 9 + typescript-eslint) : détection des erreurs de style, imports inutilisés et `any` non autorisés.
3. `npm run test:coverage` (Jest) : exécution des 465+ tests unitaires et de non-régression (Golden Master) avec génération du rapport de couverture LCOV dans `backend/coverage/lcov.info`. En CI, ce passage inclut les tests PostgreSQL réels (`DB_IT=1`, base préparée par `prisma db push`) : les services du tournoi sont testés presque uniquement par eux, donc la couverture envoyée à Sonar les compte (82 % des lignes au total, contre 73 % sans eux).

---

## ⚙️ 2. Architecture du Pipeline CI (GitHub Actions)

Le workflow `.github/workflows/ci.yml` se déclenche sur chaque `push` vers `main` et sur chaque `pull_request` vers `main`.
Le job `changes` regarde les fichiers modifiés par la PR et décide quels jobs lancer (sur `main`, ou si le workflow lui-même change, tout tourne) :

| Job | Se lance si la PR touche | Contenu |
|---|---|---|
| `Typecheck, Lint, Test & SonarQube Coverage` | `backend/`, `test/`, `infra/` | typecheck, lint, Jest avec couverture (Golden Master et tests PostgreSQL réels `DB_IT=1` inclus, en un seul passage), build NestJS, audit des dépendances (informatif), analyse SonarQube |
| `End-to-end tournament scenario` | `backend/`, `test/`, `infra/` | backend réel démarré sur PostgreSQL 16 et Redis 7, puis `scripts/e2e-tournament.mjs` (l'équivalent de `make e2e-tournament`) |
| `Go agent (build, vet, tests)` | `agent/` | `go build ./...`, `go vet ./...`, `go test ./...` |
| `Docker images build` | un Dockerfile, `infra/`, `agent/`, `tools/log-drain/`, `backend/package*` ou `backend/prisma` | `docker build` (sans publication) du backend de dev, de l'agent/manager Go et de `tools/log-drain`. Le `Dockerfile` racine et `docker-compose.monolith.yml` ne sont pas construits : ils copient des dossiers qui n'existent plus |
| `Dockerfiles and shell scripts` | un Dockerfile, un `.sh`, `infra/`, `scripts/` | shellcheck (avertissements et erreurs, pas les remarques « info », qui varient selon la version) et hadolint (erreurs seulement : les avertissements de style ne bloquent pas) |
| `CI OK` | toujours | réussi si tous les jobs qui devaient tourner ont réussi (un job ignoré compte comme réussi) |

**`CI OK` est le seul contrôle à exiger avant fusion** (protection de `main`). Comme chaque job décide seul s'il tourne, une PR qui ne touche que de la documentation n'attend pas un contrôle qui ne viendra jamais.

Sur une PR, une porte qualité SonarQube en échec fait échouer le job (`sonar.qualitygate.wait`). La porte ne regarde que le code nouveau. Sans le secret `SONAR_TOKEN` (PR venant d'un fork ou de Dependabot), l'analyse est ignorée.

Les actions sont épinglées par empreinte de commit (le tag est en commentaire) ; Dependabot (`.github/dependabot.yml`) met à jour l'empreinte et le commentaire ensemble, chaque mois, avec les dépendances npm du backend, les modules Go de l'agent, les images Docker et les actions. Les mineures et correctifs d'un écosystème arrivent groupés en une PR (sûre à fusionner quand `CI OK` est vert) ; NestJS d'un côté et Prisma de l'autre arrivent chacun en une seule PR, majeures comprises ; la majeure de tout le reste (une action, une image, un module Go) arrive seule. Les montées de version majeures ne sont pas ignorées : on les traite une à la fois, entre deux tournois (ne pas fermer la PR, Dependabot cesserait de la proposer). Seules les versions impaires de Node sont exclues, car elles n'ont pas de support long.

---

## 🛡️ 3. Configuration de SonarQube / SonarCloud

### Pourquoi aucun composant Java/Jakarta n'est nécessaire ?
- **JaCoCo** et **Jakarta** sont réservés aux projets Java.
- En TypeScript, Jest génère nativement le format **LCOV**.
- Le fichier `backend/sonar-project.properties` pointe directement vers ce fichier :
  ```properties
  sonar.javascript.lcov.reportPaths=coverage/lcov.info
  ```

### Configuration des Secrets GitHub
Pour connecter GitHub Actions à votre instance Sonar :

1. Dans **SonarQube / SonarCloud** :
   - Aller dans **Mon Compte > Sécurité > Générer un jeton (Token)** (Type: *Global Analysis Token* ou *Project Analysis Token*).
   - Copier le token généré.

2. Dans le **dépôt GitHub** :
   - Aller dans **Settings > Secrets and variables > Actions > New repository secret**.
   - Créer `SONAR_TOKEN` avec la valeur du token.
   - Créer `SONAR_HOST_URL` avec l'URL de votre serveur SonarQube (ex: `https://sonar.mondomaine.fr`).  
     *(Note : Si vous utilisez SonarCloud.io, `SONAR_HOST_URL` est `https://sonarcloud.io`)*.

---

## 📊 4. Métriques suivies par SonarQube

Une fois le scan exécuté, le dashboard SonarQube affiche :
- **Quality Gate** : Statut Passed / Failed selon vos règles (seuil de couverture, bugs bloquants).
- **Couverture de code (Code Coverage)** : Pourcentage de lignes et branches couvertes via `lcov.info`.
- **Dette technique** : Temps estimé de remédiation des Code Smells.
- **Sécurité** : Détection des vulnérabilités et failles de sécurité (injections, secrets exposés).
- **Duplication** : Pourcentage de code dupliqué.
