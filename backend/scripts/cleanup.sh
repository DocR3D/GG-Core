#!/usr/bin/env bash
set -euo pipefail

# 0) sécurité sur les chemins
cd "$(dirname "$0")"

echo "== Création des dossiers manquants =="
mkdir -p src/adapters/bus
mkdir -p src/docs

echo "== Bus: créer le module AdaptersBusModule s'il n'existe pas =="
if [ ! -f src/adapters/bus/bus.module.ts ]; then
  cat > src/adapters/bus/bus.module.ts <<'EOF'
import { Module } from '@nestjs/common';
import { BusPublisher } from './publisher';

@Module({
  providers: [BusPublisher],
  exports: [BusPublisher],
})
export class AdaptersBusModule {}
EOF
fi

echo "== Bus: utiliser AdaptersBusModule côté app si présent =="
# Si application/bus/bus.module.ts existe, on le transforme en 'port' qui importe le vrai module adapters
if [ -f src/application/bus/bus.module.ts ]; then
  sed -i "1i import { AdaptersBusModule } from '@adapters/bus/bus.module';" src/application/bus/bus.module.ts
  # Ajoute AdaptersBusModule aux imports si pas déjà présent
  grep -q "AdaptersBusModule" src/application/bus/bus.module.ts || \
  sed -i "s/@Module({/@Module({\n  imports: [AdaptersBusModule],/" src/application/bus/bus.module.ts
fi

echo "== WS: normaliser le naming (Broadcaster public, Emitter interne) =="
if [ -f src/adapters/ws/ws-emitter.service.ts ]; then
  git mv -f src/adapters/ws/ws-emitter.service.ts src/adapters/ws/ws-emitter.internal.ts || true
fi
# Corriger les imports
grep -rl "@adapters/ws/ws-emitter.service" src 2>/dev/null | xargs -r sed -i "s#@adapters/ws/ws-emitter.service#@adapters/ws/ws-emitter.internal#g"
grep -rl "from '\\./ws-emitter.service'" src/adapters/ws 2>/dev/null | xargs -r sed -i "s#from '\\./ws-emitter.service'#from './ws-emitter.internal'#g"

echo "== HTTP: supprimer dossier parsers vide s'il existe =="
[ -d src/adapters/http/parsers ] && rmdir --ignore-fail-on-non-empty src/adapters/http/parsers || true

echo "== Barrels: domain/events/index.ts (si absent) =="
if [ ! -f src/domain/events/index.ts ]; then
  cat > src/domain/events/index.ts <<'EOF'
export * from './event.types';
export * from './base.event';
export * from './match.event';
export * from './chat.event';
export * from './raw-log.event';
export * from './command.event';
export * from './internal-events';
EOF
fi

echo "== Barrels: application/match/rules/index.ts (si absent) =="
if [ ! -f src/application/match/rules/index.ts ]; then
  cat > src/application/match/rules/index.ts <<'EOF'
export * from './knife.rule';
export * from './knife-choice.rule';
export * from './live.rule';
export * from './warmup.rule';
export * from './rule.registry';
EOF
fi

echo "== Lint import order (ESLint rule) – exemple .eslintrc.json snippet =="
if [ ! -f .eslintrc.json ]; then
  cat > .eslintrc.json <<'EOF'
{
  "root": true,
  "parser": "@typescript-eslint/parser",
  "plugins": ["@typescript-eslint", "import"],
  "extends": ["plugin:@typescript-eslint/recommended"],
  "rules": {
    "import/order": ["error", {
      "groups": ["builtin", "external", "internal", "parent", "sibling", "index"],
      "pathGroups": [
        { "pattern": "@domain/**", "group": "internal", "position": "before" },
        { "pattern": "@app/**",    "group": "internal", "position": "before" },
        { "pattern": "@adapters/**","group": "internal", "position": "before" }
      ],
      "pathGroupsExcludedImportTypes": ["builtin"],
      "alphabetize": { "order": "asc", "caseInsensitive": true },
      "newlines-between": "always"
    }]
  }
}
EOF
fi

echo "== README: doc architecture courte (src/README.md) =="
cat > src/README.md <<'EOF'
# Architecture (perspective rapide)

## Couches
- **domain/** : logique et types métier. Aucune dépendance Nest/I/O.
- **application/** : services métier et cas d’usage. Peut dépendre de Nest, ne parle pas à l’I/O directement.
- **adapters/** : interfaces techniques (HTTP, WS, Redis streams, Bus). Dépend des services `application`.

Flux : adapters → application → domain. Pas l’inverse.

## Détails
- **domain/events/** : types d'événements canoniques (source de vérité).
- **adapters/ws/dto/** : contrats WebSocket pour le front + `events.mapper.ts` (domain → WS).
- **adapters/streams/** : consommateurs des flux (Redis/XREAD) → délèguent à `application/subscribers/*`.
- **application/subscribers/** : handlers métier (routing, règles, orchestration).
- **application/match/rules/** : règles concrètes (knife, live, warmup) + `RuleRegistry`.
- **application/match/state/** : état match, scoreboard, économies, `redis.keys.ts`.
- **adapters/bus/** : `BusPublisher` (bridge pub events vers bus).
- **adapters/redis/** : clients Redis / tokens DI (infra).

## Convention de nommage
- Fichiers : kebab-case + suffixes Nest (`.module.ts`, `.service.ts`, `.controller.ts`, `.gateway.ts`, `.guard.ts`, `.consumer.ts`, `.dto.ts`, `.types.ts`).
- Classes : `PascalCase` + suffixe (`*Module`, `*Service`, etc.).
- Règles : `*.rule.ts`.
- Clés métier : `*.keys.ts` dans `application/*`. Tokens DI infra : `adapters/*`.

EOF

echo "== README: adapter bus (src/adapters/bus/README.md) =="
cat > src/adapters/bus/README.md <<'EOF'
# adapters/bus
Expose un `BusPublisher` (pub sur Redis stream, Kafka, etc. selon implémentation). 
Consommé par `application` via `AdaptersBusModule`. Aucun métier ici.
EOF

echo "== README: streams vs subscribers (src/adapters/streams/README.md) =="
cat > src/adapters/streams/README.md <<'EOF'
# adapters/streams
Plomberie d'abonnement (XREAD, clients, retries). Ne contient pas de logique métier.
Dès qu'un message est reçu, on le transforme en évènement domaine et on délègue à `application/subscribers/*`.
EOF

echo "== README: subscribers (src/application/subscribers/README.md) =="
cat > src/application/subscribers/README.md <<'EOF'
# application/subscribers
Handlers métier qui réagissent aux évènements (provenant des adapters/streams).
Ici on appelle les règles, met à jour l'état, déclenche l'orchestrateur, etc.
EOF

echo "== Petit coup de balai imports obsolètes =="
# ws-emitter ancien nom
grep -rl "@adapters/ws/ws-emitter.service" src 2>/dev/null | xargs -r sed -i "s#@adapters/ws/ws-emitter.service#@adapters/ws/ws-emitter.internal#g"

echo "== Build =="
npm run build || npx tsc --noEmit

echo "== OK =="
