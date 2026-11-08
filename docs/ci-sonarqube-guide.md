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
3. `npm run test:coverage` (Jest) : exécution des 465+ tests unitaires et de non-régression (Golden Master) avec génération du rapport de couverture LCOV dans `backend/coverage/lcov.info`.

---

## ⚙️ 2. Architecture du Pipeline CI (GitHub Actions)

Le workflow `.github/workflows/backend-ci.yml` se déclenche automatiquement :
- Sur chaque `push` vers `main`, `new-main`, `feat/**`, `ci/**`.
- Sur chaque `pull_request` vers `main`.

### Étapes exécutées dans le runner Ubuntu :
1. **Services** : Démarrage d'un conteneur `postgres:16-alpine` dédié aux tests d'intégration.
2. **Setup** : Node.js 20 avec cache des modules npm.
3. **Prisma** : Génération du client (`npx prisma generate`).
4. **Validation Qualité** :
   - `npm run typecheck`
   - `npm run lint`
   - `npm run test:coverage` (produit `coverage/lcov.info`)
5. **Intégration BDD réelle** :
   - Migration du schéma test : `npx prisma db push --skip-generate`
   - Exécution de la suite DB : `DB_IT=1 npx jest --config jest.config.ts db.spec`
6. **Build** : Compilation NestJS (`npm run build`).
7. **Analyse SonarQube** : Envoi des métriques et du rapport de couverture au serveur Sonar.

---

## 🛡️ 3. Configuration de SonarQube / SonarCloud

### Pourquoi aucun composant Java/Jakarta n'est nécessaire ?
- **JaCoCo** et **Jakarta** sont réservés aux projets Java.
- En TypeScript, Jest génère nativement le format **LCOV**.
- Le fichier `backend/sonar-project.properties` pointe directement vers ce fichier :
  ```properties
  sonar.javascript.lcov.reportPaths=backend/coverage/lcov.info
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
