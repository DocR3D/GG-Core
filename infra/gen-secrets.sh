#!/usr/bin/env bash
# Creates / completes .env (repo root, git-ignored) with RANDOM secrets - called by the Makefile before anything
# else. Never overwrites an existing value: sessions, RCON and the agent keep working across runs. A key missing
# after an update is added. Messages go to stderr (the Makefile captures stdout).
set -eu
cd "$(dirname "$0")/.."
f=.env

rand() { LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom 2>/dev/null | head -c "$1" || true; }

if [ ! -f "$f" ]; then
  : >"$f"
  chmod 600 "$f" 2>/dev/null || true
fi

added=()
add() {
  if ! grep -q "^$1=" "$f"; then
    echo "$1=$2" >>"$f"
    added+=("$1")
  fi
}

add JWT_SECRET "$(rand 48)"        # signs the login sessions
add GG_ADMIN_TOKEN "$(rand 40)"    # scripts / curl: Authorization: Bearer <token>
add GG_ADMIN_PASSWORD "$(rand 16)" # offline admin login on /login
add GG_LOGS_TOKEN "$(rand 32)"     # CS2 -> agent log ingestion
add GG_RCON_PASSWORD "$(rand 20)"  # RCON of the CS2 servers
grep -q '^GG_ADMIN_STEAMIDS=' "$f" || echo 'GG_ADMIN_STEAMIDS=' >>"$f"

if [ ${#added[@]} -gt 0 ]; then
  echo "🔐 .env : secrets générés (${added[*]})" >&2
  case " ${added[*]} " in
    *" GG_ADMIN_PASSWORD "*) echo "   Mot de passe admin (connexion hors ligne sur /login) : $(grep '^GG_ADMIN_PASSWORD=' "$f" | cut -d= -f2-)" >&2 ;;
  esac
  echo "   Pour te connecter avec Steam : mets ton SteamID64 dans GG_ADMIN_STEAMIDS (.env). Retrouver le mot de passe : make admin" >&2
fi
