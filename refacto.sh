#!/usr/bin/env bash
set -euo pipefail

echo "==> Refactor monorepo GG-Core"
shopt -s nullglob dotglob

# Detect git
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  USE_GIT=1
  echo "Detected git repository."
else
  USE_GIT=0
  echo "No git repo detected, falling back to plain 'mv'."
fi

mvx () {
  local src="$1" dst="$2"
  if [ ! -e "$src" ]; then
    echo "    (skip) $src not found"
    return 0
  fi
  mkdir -p "$(dirname "$dst")"
  if [ "$USE_GIT" -eq 1 ]; then
    # Try git mv; if it fails (untracked), fallback to mv
    if git mv "$src" "$dst" >/dev/null 2>&1; then
      echo "    git mv $src -> $dst"
    else
      mv "$src" "$dst"
      echo "    mv     $src -> $dst"
    fi
  else
    mv "$src" "$dst"
    echo "    mv     $src -> $dst"
  fi
}

rmdir_if_empty () {
  local d="$1"
  if [ -d "$d" ] && [ -z "$(ls -A "$d")" ]; then
    rmdir "$d" || true
  fi
}

echo "==> Create top-level folders (if missing)"
mkdir -p backend frontend agent infra

echo "==> Agent: rename cmd if present"
if [ -d "agent/cmd/agent" ]; then
  mvx "agent/cmd/agent" "agent/cmd/ggbot-agent"
else
  echo "    (info) agent/cmd/agent not present (maybe already renamed)"
fi

echo "==> Agent: move config.yaml if present"
mvx "agent/config.yaml" "agent/configs/default.yaml"

echo "==> Agent: ensure target structure exists"
mkdir -p agent/internal/{app,bus/redis,config,domain,ingest/httpLogs,logger,version}

echo "==> Agent: move logs -> ingest/httpLogs (recursive)"
if [ -d "agent/internal/logs" ]; then
  # Move all children of logs/ into ingest/httpLogs/
  for p in agent/internal/logs/*; do
    mvx "$p" "agent/internal/ingest/httpLogs/$(basename "$p")"
  done
  rmdir_if_empty "agent/internal/logs"
else
  echo "    (info) agent/internal/logs not present (already moved?)"
fi

echo "==> Backend: nothing changed if déjà en place"
if [ -d "GG-Core/backend" ]; then
  # Rare layout; move children into backend/
  for p in GG-Core/backend/*; do mvx "$p" "backend/$(basename "$p")"; done
fi

echo "==> Frontend: similar"
if [ -d "GG-Core/frontend" ]; then
  for p in GG-Core/frontend/*; do mvx "$p" "frontend/$(basename "$p")"; done
fi

echo "==> Infra: docker-compose*, Dockerfile, infra/* → infra/"
# docker-compose*.yml (root)
for f in docker-compose*.yml; do mvx "$f" "infra/$f"; done
# root Dockerfile
if [ -f "Dockerfile" ]; then mvx "Dockerfile" "infra/Dockerfile"; fi
# pre-existing infra/* at root to infra/
if [ -d "infra" ]; then
  # nothing; already there
  :
fi

echo "==> Final touch: git add (if git)"
if [ "$USE_GIT" -eq 1 ]; then
  git add -A
fi

echo "==> Done. Check 'git status' then commit."
