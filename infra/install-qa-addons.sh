#!/usr/bin/env bash
# Installe ou met à jour Metamod:Source 2.0, CounterStrikeSharp (with-runtime)
# et compile le plugin GGCore.QaOracle dans infra/qa-addons/ pour le profil `cs2-qa`.
#
# Usage : bash infra/install-qa-addons.sh

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ADDONS_DIR="$ROOT_DIR/infra/qa-addons"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

echo "📦 Préparation de $ADDONS_DIR..."
mkdir -p "$ADDONS_DIR"

# 1. Metamod:Source 2.0 (Linux)
echo "⬇️  Téléchargement de Metamod:Source 2.0 (Linux)..."
MM_LATEST_FILE="$(curl -fsSL https://mms.alliedmods.net/mmsdrop/2.0/mmsource-latest-linux)"
MM_URL="https://mms.alliedmods.net/mmsdrop/2.0/${MM_LATEST_FILE}"
curl -fsSL "$MM_URL" -o "$TMP_DIR/metamod.tar.gz"
tar -xzf "$TMP_DIR/metamod.tar.gz" -C "$TMP_DIR"
cp -r "$TMP_DIR/addons/"* "$ADDONS_DIR/"
echo "✅ Metamod installé ($MM_LATEST_FILE)"

# 2. CounterStrikeSharp (dernière release Linux with-runtime)
echo "⬇️  Téléchargement de CounterStrikeSharp (with-runtime Linux)..."
CSS_URL="$(curl -fsSL https://api.github.com/repos/roflmuffin/CounterStrikeSharp/releases/latest \
  | grep -oE '"browser_download_url":\s*"[^"]*with-runtime-linux-[^"]*\.zip"' \
  | head -n 1 \
  | cut -d'"' -f4)"

if [ -z "$CSS_URL" ]; then
  echo "❌ Impossible de trouver l'archive CounterStrikeSharp with-runtime Linux sur GitHub."
  exit 1
fi

curl -fsSL "$CSS_URL" -o "$TMP_DIR/css.zip"
unzip -qo "$TMP_DIR/css.zip" -d "$TMP_DIR/css"
cp -r "$TMP_DIR/css/addons/"* "$ADDONS_DIR/"
echo "✅ CounterStrikeSharp installé ($(basename "$CSS_URL"))"

# 3. Compilation du plugin GGCore.QaOracle via Docker (.NET 8 SDK)
echo "🔨 Compilation du plugin GGCore.QaOracle..."
PLUGIN_OUT="$ADDONS_DIR/counterstrikesharp/plugins/GGCore.QaOracle"
mkdir -p "$PLUGIN_OUT"
docker build --output "type=local,dest=$PLUGIN_OUT" "$ROOT_DIR/tools/qa-oracle"
echo "✅ Plugin GGCore.QaOracle compilé dans $PLUGIN_OUT"

# 4. Patch gameinfo.gi dans le volume infra_cs2data si présent
if docker volume inspect infra_cs2data >/dev/null 2>&1; then
  echo "🔧 Vérification de gameinfo.gi dans le volume infra_cs2data..."
  docker run --rm -v infra_cs2data:/cs2 alpine:3.20 sh -c '
    GI="/cs2/game/csgo/gameinfo.gi"
    if [ ! -f "$GI" ]; then
      echo "ℹ️  gameinfo.gi absent (CS2 pas encore téléchargé)."
      exit 0
    fi
    if grep -q "csgo/addons/metamod" "$GI"; then
      echo "✅ gameinfo.gi contient déjà Metamod."
    else
      sed -i "s|\(Game[[:space:]]*csgo\)\r\?$|Game\tcsgo/addons/metamod\n\t\t\t\1|" "$GI"
      if grep -q "csgo/addons/metamod" "$GI"; then
        echo "✅ gameinfo.gi patché pour charger Metamod."
      else
        echo "❌ Échec du patch de gameinfo.gi" >&2
        exit 1
      fi
    fi
  '
fi

echo "🎉 Addons QA prêts ! Redémarre cs2-qa si déjà lancé : make up-cs2-qa"
