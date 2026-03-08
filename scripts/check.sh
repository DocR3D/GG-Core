#!/usr/bin/env bash
# =============================================================================
# GG-Core — Script de vérification (compilation + smoke test)
# Usage : ./scripts/check.sh [--no-smoke]
# =============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
COMPOSE_FILE="$ROOT/infra/docker-compose.ci.yml"
NO_SMOKE=false

for arg in "$@"; do
  [[ "$arg" == "--no-smoke" ]] && NO_SMOKE=true
done

# Couleurs
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
ok()   { echo -e "${GREEN}✅ $*${NC}"; }
fail() { echo -e "${RED}❌ $*${NC}"; exit 1; }
info() { echo -e "${YELLOW}▶  $*${NC}"; }

# ─────────────────────────────────────────────────
# 1. TYPECHECK BACKEND (TypeScript)
# ─────────────────────────────────────────────────
info "1/3 — Typecheck TypeScript (backend)"
cd "$ROOT/backend"

if ! command -v node &>/dev/null; then
  fail "node non trouvé — installe Node.js 20+"
fi

# Installe les deps si node_modules absent
if [ ! -d node_modules ]; then
  info "  Installation des dépendances npm..."
  npm ci --silent
fi

# tsc --noEmit : vérifie les types sans écrire de fichiers
npx tsc --noEmit --project tsconfig.build.json 2>&1 \
  | grep -v "^$" \
  | head -40 \
  || fail "Erreurs TypeScript détectées (voir ci-dessus)"

ok "TypeScript OK"

# ─────────────────────────────────────────────────
# 2. BUILD BACKEND (NestJS)
# ─────────────────────────────────────────────────
info "2/3 — Build NestJS"
cd "$ROOT/backend"

npm run build 2>&1 | tail -5 || fail "Build NestJS échoué"
ok "Build NestJS OK"

# ─────────────────────────────────────────────────
# 3. BUILD AGENT GO
# ─────────────────────────────────────────────────
info "2b/3 — Build Agent Go"
cd "$ROOT/agent"

if ! command -v go &>/dev/null; then
  info "  go non trouvé localement — skip (sera vérifié dans Docker)"
else
  go build ./cmd/manager 2>&1 || fail "Build manager Go échoué"
  go build ./cmd/agent   2>&1 || fail "Build agent Go échoué"
  ok "Build Go OK"
fi

# ─────────────────────────────────────────────────
# 4. SMOKE TEST (démarrage + health check)
# ─────────────────────────────────────────────────
if [ "$NO_SMOKE" = true ]; then
  info "3/3 — Smoke test ignoré (--no-smoke)"
  ok "Vérifications terminées (sans smoke test)"
  exit 0
fi

info "3/3 — Smoke test (docker compose CI)"

cd "$ROOT"
docker compose -f "$COMPOSE_FILE" down --remove-orphans --volumes 2>/dev/null || true
docker compose -f "$COMPOSE_FILE" up --build --abort-on-container-exit \
  --exit-code-from smoke 2>&1

STATUS=$?
docker compose -f "$COMPOSE_FILE" down --remove-orphans --volumes 2>/dev/null || true

if [ $STATUS -ne 0 ]; then
  fail "Smoke test échoué (exit $STATUS)"
fi

ok "Smoke test OK"
ok "────────────────────────────────────────"
ok "Toutes les vérifications sont passées !"
