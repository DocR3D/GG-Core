# GG-Core - Backend NestJS

Cœur de GG-Core : moteur de match CS2 (règles par phase, état Redis), tournois (poules, double élimination, véto,
opérations admin), API REST, WebSocket Socket.IO, pages HTML (`/view`, `/veto`, `/login`) et outils de dev
(`/sandbox`, `/sandbox/tournament`). Port `8081`.

La stack complète se lance depuis la racine du dépôt (`make up`, voir le [README racine](../README.md)).

## Hors Docker

```bash
npm install
npx prisma generate
npx prisma db push      # schéma sur la base de DATABASE_URL
npm run start:dev       # http://localhost:8081/sandbox
```

Configuration : `.env` à partir de `.env.example` (Redis, PostgreSQL, secrets d'authentification).

## Validation

```bash
npm run typecheck
npm run build
npm test                                            # Jest, dont le Golden Master sur fixtures réelles
DB_IT=1 npx jest --config jest.config.ts db.spec    # intégration sur un vrai PostgreSQL
```

## Documentation

- Architecture, endpoints, clés Redis : [`docs/context/backend.md`](../docs/context/backend.md)
- Règles du projet pour les contributeurs et agents : [`AGENTS.md`](../AGENTS.md)
- Backlog : [`docs/context/todo.md`](../docs/context/todo.md)
