#!/usr/bin/env bash
set -euo pipefail

ROOT="src"

# Utilise tous les .ts trackés par git, sinon find
TS_FILES=$(git ls-files "$ROOT/**/*.ts" 2>/dev/null || find "$ROOT" -type f -name "*.ts")

# --- A) cs2-logs → handle-log-line (dans ADAPTERS HTTP qui importent le use-case)
# Chemins relatifs depuis: src/adapters/http/*.ts  →  src/application/use-cases/handle-log-line.service
echo "$TS_FILES" | xargs sed -i -e "s#\./cs2-logs\.service#../../application/use-cases/handle-log-line.service#g"

# --- B) app.module.ts : anciens modules vers nouveaux emplacements
# ./cs2-logs/cs2-logs.module → ./adapters/http/cs2-logs.module
sed -i -e "s#'\./cs2-logs/cs2-logs\.module'#'./adapters/http/cs2-logs.module'#g" src/app.module.ts 2>/dev/null || true
# ./health/health.controller → ./adapters/http/health/health.controller
sed -i -e "s#'\./health/health\.controller'#'./adapters/http/health/health.controller'#g" src/app.module.ts 2>/dev/null || true
# ./commands/commands.module → ./application/commands.module
sed -i -e "s#'\./commands/commands\.module'#'./application/commands.module'#g" src/app.module.ts 2>/dev/null || true
# ./match-state/match-state.module → ./application/match-state.module
sed -i -e "s#'\./match-state/match-state\.module'#'./application/match-state.module'#g" src/app.module.ts 2>/dev/null || true
# ./admin/admin.module → ./application/admin.module
sed -i -e "s#'\./admin/admin\.module'#'./application/admin.module'#g" src/app.module.ts 2>/dev/null || true

# --- C) application/admin.module.ts et application/commands.module.ts : import de MatchStateModule
# ../match-state/match-state.module → ./match-state.module
sed -i -e "s#'\.\./match-state/match-state\.module'#'./match-state.module'#g" src/application/admin.module.ts 2>/dev/null || true
sed -i -e "s#'\.\./match-state/match-state\.module'#'./match-state.module'#g" src/application/commands.module.ts 2>/dev/null || true

# --- D) application/commands.module.ts : path du CommandsProcessor renommé
# ./commands-processor/commands-processor.service → ./use-cases/commands-processor.uc
sed -i -e "s#'\./commands-processor/commands-processor\.service'#'./use-cases/commands-processor.uc'#g" src/application/commands.module.ts 2>/dev/null || true

# --- E) application/match-state.module.ts : path du subscriber renommé
# ./match-state/match-state-handler.service → ./subscribers/match-state-handler.subscriber
sed -i -e "s#'\./match-state/match-state-handler\.service'#'./subscribers/match-state-handler.subscriber'#g" src/application/match-state.module.ts 2>/dev/null || true

# --- F) subscriber : path du service de state
# ./match-state.service → ../state/match-state.service
sed -i -e "s#'\./match-state\.service'#'../state/match-state.service'#g" src/application/subscribers/match-state-handler.subscriber.ts 2>/dev/null || true

# --- G) alias “@” mal écrits avec ../@xxx → enlever le ../
echo "$TS_FILES" | xargs sed -i -e "s#\.\./@domain/#@domain/#g"
echo "$TS_FILES" | xargs sed -i -e "s#\.\./@app/#@app/#g"
echo "$TS_FILES" | xargs sed -i -e "s#\.\./@adapters/#@adapters/#g"

echo "✅ Imports corrigés."
