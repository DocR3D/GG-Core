#!/usr/bin/env bash
# Adds a CS2 server of the LAN in one go (`make server NAME=srv-b IP=10.0.0.12`):
#   1. agents.d/<NAME>.yaml with the next free log port (8082-8113): the manager starts its agent by itself;
#      the secrets stay references to .env (${GG_RCON_PASSWORD}, ${GG_LOGS_TOKEN}), never written in the file;
#   2. the server registered in the tournament (POST /api/tournament/servers), so games can be launched on it;
#   3. the two lines to paste in the CS2 server's config;
#   4. a check that the agent reaches the server in RCON (and later, that logs arrive: make servers).
# Called by the Makefile with COMPOSE, API and GG_ADMIN_TOKEN in the environment.
set -eu
cd "$(dirname "$0")/.."

NAME=${1:-}
IP=${2:-}
GAME_PORT=${3:-27015}
LAN_IP=${4:-}
FIRST_LOG_PORT=8082
LAST_LOG_PORT=8113 # published by infra/docker-compose.dev.yml (manager): 32 servers

usage() { echo "Usage : make server NAME=srv-b IP=<IP du serveur CS2> [PORT=27015] [LAN_IP=<IP de cette machine>]" >&2; exit 1; }
[ -n "$NAME" ] && [ -n "$IP" ] || usage
[[ "$NAME" =~ ^[a-z0-9][a-z0-9-]{0,31}$ ]] || { echo "❌ NAME : minuscules, chiffres et tirets (ex. srv-b)" >&2; exit 1; }
[[ "$IP" =~ ^[A-Za-z0-9.-]+$ ]] || { echo "❌ IP invalide : $IP" >&2; exit 1; }
[[ "$GAME_PORT" =~ ^[0-9]+$ ]] || { echo "❌ PORT invalide : $GAME_PORT" >&2; exit 1; }

file="agents.d/$NAME.yaml"
if [ -e "$file" ]; then
  echo "❌ $file existe déjà. Pour le refaire : supprimer le fichier (son agent s'arrête), puis relancer." >&2
  exit 1
fi

# Next free log port: one per agent, taken from the existing configs
used=$(grep -ho 'bind: *"0\.0\.0\.0:[0-9]*"' agents.d/*.yaml 2>/dev/null | grep -o '[0-9]*"$' | tr -d '"' || true)
LOG_PORT=""
for p in $(seq "$FIRST_LOG_PORT" "$LAST_LOG_PORT"); do
  if ! grep -qx "$p" <<<"$used"; then LOG_PORT=$p; break; fi
done
[ -n "$LOG_PORT" ] || { echo "❌ Plus de port de logs libre ($FIRST_LOG_PORT-$LAST_LOG_PORT)" >&2; exit 1; }

cat >"$file" <<EOF
# CS2 server "$NAME" of the LAN - written by \`make server\`. Secrets come from .env through the manager.
version: 1
serverId: $NAME

cs2:
  addr: "$IP"
  port: $GAME_PORT
  rconPassword: "\${GG_RCON_PASSWORD}"
  rcon:
    connectTimeoutMs: 2000
    commandTimeoutMs: 2000
    rateLimitPerSec: 6

cstv:
  enabled: false

logs:
  bind: "0.0.0.0:$LOG_PORT"
  token: "\${GG_LOGS_TOKEN}"
  backendPostUrl: "\${GG_BACKEND_URL:-http://127.0.0.1:8081}/cs2/logs"
  batch:
    maxLines: 100
    maxDelayMs: 75
    maxBytes: 65536
  retry:
    baseMs: 200
    maxMs: 5000
    jitter: true
    maxBufferLines: 10000

redis:
  url: "\${GG_REDIS_URL:-redis://127.0.0.1:6379}"
  actionsChannel: "ggbot:agent:$NAME:actions"
  stateKey: "ggbot:agent:$NAME:state"
  stateTtlSec: 10
EOF
echo "✅ $file (logs sur le port $LOG_PORT)"

# Registered in the tournament (already there: fine, e.g. the file was recreated)
code=$(curl -s -o /tmp/ggcore-add-server.$$ -w '%{http_code}' -X POST "$API/api/tournament/servers" \
  -H 'Content-Type: application/json' -H "Authorization: Bearer $GG_ADMIN_TOKEN" \
  -d "{\"name\":\"$NAME\",\"ip\":\"$IP\",\"port\":$GAME_PORT}" || echo 000)
case "$code" in
  2??) echo "✅ Serveur $NAME enregistré dans le tournoi" ;;
  409) echo "✅ Serveur $NAME déjà enregistré dans le tournoi" ;;
  000) echo "⚠️  Backend injoignable ($API) : serveur non enregistré. Relancer la commande une fois la stack lancée (make up)." ;;
  *) echo "⚠️  Enregistrement refusé (HTTP $code) : $(cat /tmp/ggcore-add-server.$$ 2>/dev/null)" ;;
esac
rm -f /tmp/ggcore-add-server.$$

# Address of this machine as the CS2 servers see it
if [ -z "$LAN_IP" ]; then LAN_IP=$(grep '^GG_LAN_IP=' .env 2>/dev/null | cut -d= -f2- || true); fi
if [ -z "$LAN_IP" ]; then
  LAN_IP=$(ip route get 1.1.1.1 2>/dev/null | awk '{for (i = 1; i < NF; i++) if ($i == "src") print $(i + 1)}' | head -1)
  guessed=1
fi
if grep -qi microsoft /proc/version 2>/dev/null && [ "${guessed:-0}" = 1 ]; then
  echo "⚠️  WSL : l'adresse détectée ($LAN_IP) est celle de la VM, invisible du réseau de la LAN. Donner l'IP de"
  echo "   Windows sur la LAN (LAN_IP=… ou GG_LAN_IP dans .env) et ouvrir le port $LOG_PORT vers WSL (réseau"
  echo "   « mirrored » de WSL, ou netsh interface portproxy)."
fi

rcon=$(grep '^GG_RCON_PASSWORD=' .env | cut -d= -f2-)
token=$(grep '^GG_LOGS_TOKEN=' .env | cut -d= -f2-)
echo ""
echo "À mettre dans la config du serveur CS2 ($IP:$GAME_PORT), par exemple server.cfg :"
echo ""
echo "  rcon_password \"$rcon\""
echo "  log on"
echo "  logaddress_add_http \"http://$LAN_IP:$LOG_PORT/logs?token=$token\""
echo ""

# The manager picks the file up within a few seconds; the agent then tries RCON at each heartbeat (~3 s)
echo -n "Connexion RCON à $IP:$GAME_PORT "
state=""
for _ in $(seq 1 10); do
  sleep 2
  echo -n "."
  state=$($COMPOSE exec -T redis redis-cli GET "ggbot:agent:$NAME:state" 2>/dev/null || true)
  if grep -q '"connected":true' <<<"$state"; then break; fi
done
echo ""
if [ -z "$state" ]; then
  echo "⚠️  L'agent de $NAME ne répond pas encore (make logs S=manager)."
elif grep -q '"connected":true' <<<"$state"; then
  echo "✅ RCON OK. Une fois la config collée sur le serveur CS2, vérifier l'arrivée des logs : make servers"
else
  err=$(grep -o '"error":"[^"]*"' <<<"$state" | cut -d'"' -f4)
  echo "❌ RCON pas encore joignable${err:+ : $err}"
  echo "   Normal si le serveur CS2 n'a pas encore la config ci-dessus. Ensuite : make servers"
fi
