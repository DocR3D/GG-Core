# GG-Core - point d'entrée unique du projet (Linux, macOS, Windows via WSL).
# Seul prérequis : Docker (+ Compose v2). Ni Node ni Go à installer : tout tourne en conteneurs.
#
#   make            → aide
#   make up         → stack complète (Redis, Postgres, backend, agent)
#   make up-cs2     → + serveur CS2 dédié en conteneur
#   make up CS2=local → agent branché sur un CS2 lancé hors Docker (ex. Steam Windows)
#   make test       → typecheck + Jest + Go + intégration PostgreSQL

SHELL        := /bin/bash
# Secrets: .env (git-ignored) created / completed with RANDOM values on the first make - nothing to configure,
# no public default. Only the admin token is read here (loading the whole .env would override variables given
# on the command line, e.g. GG_ADMIN_STEAMIDS=<id> make up).
_SECRETS     := $(shell bash infra/gen-secrets.sh)
GG_ADMIN_TOKEN := $(shell grep '^GG_ADMIN_TOKEN=' .env 2>/dev/null | cut -d= -f2-)
COMPOSE      := docker compose --env-file .env -f infra/docker-compose.dev.yml
API          := http://localhost:8081
F            ?=
S            ?=
CS2          ?=

# CS2=local : CS2 tourne sur la machine hôte (Windows/Steam ou Linux natif).
# Sous WSL2 l'hôte Windows est la passerelle par défaut de la VM ; ailleurs host.docker.internal.
ifeq ($(CS2),local)
  GG_CS2_HOST ?= $(shell grep -qi microsoft /proc/version 2>/dev/null && ip route show default | awk '{print $$3}' || echo host.docker.internal)
  export GG_CS2_HOST
endif

.DEFAULT_GOAL := help
.PHONY: help doctor admin _core up up-cs2 down restart ps logs status sandbox replay fixtures test test-backend test-db test-go e2e-tournament tournament shell-backend psql redis-cli reset

help: ## Affiche cette aide
	@echo "GG-Core - commandes disponibles :"
	@grep -hE '^[a-zA-Z0-9_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  make %-14s %s\n", $$1, $$2}'
	@echo ""
	@echo "Options : CS2=local (CS2 hors Docker), F=<fixture> (replay), S=<service> (logs)"

doctor: ## Vérifie les prérequis (Docker, Compose, droits, disque)
	@command -v docker >/dev/null || { echo "❌ docker introuvable"; exit 1; }
	@docker compose version >/dev/null 2>&1 || { echo "❌ Docker Compose v2 introuvable"; exit 1; }
	@docker info >/dev/null 2>&1 || { echo "❌ Docker inaccessible pour $$USER → sudo usermod -aG docker $$USER puis rouvrir le terminal"; exit 1; }
	@echo "✅ Docker $$(docker version -f '{{.Server.Version}}') / $$(docker compose version --short)"
	@for c in ggcore-redis-dev ggcore-postgres-dev ggcore-backend-dev ggbot-manager ggcore-cs2-dev; do \
	  p=$$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project"}}' $$c 2>/dev/null) || continue; \
	  if [ "$$p" != "infra" ]; then echo "❌ Le conteneur $$c existe déjà hors de ce projet (créé à la main ?) et bloque son nom/ses ports."; \
	    echo "   → docker rm -f $$c   (ses données restent dans son volume)"; exit 1; fi; \
	done
	@root=$$(docker info -f '{{.DockerRootDir}}'); free=$$(df -BG --output=avail "$$root" 2>/dev/null | tail -1 | tr -dc 0-9); \
	  if [ -n "$$free" ] && [ "$$free" -lt 90 ]; then echo "⚠️  $${free} Go libres sous $$root : le serveur CS2 (make up-cs2) en demande ~75"; \
	  else echo "✅ Espace disque Docker : $${free:-?} Go libres"; fi

admin: ## Affiche la connexion admin (URL, mot de passe hors ligne, SteamID64 admins) - secrets dans .env
	@echo "Connexion : $(API)/login"
	@echo "Mot de passe admin hors ligne : $$(grep '^GG_ADMIN_PASSWORD=' .env | cut -d= -f2-)"
	@echo "Admins Steam (GG_ADMIN_STEAMIDS) : $${GG_ADMIN_STEAMIDS:-$$(grep '^GG_ADMIN_STEAMIDS=' .env | cut -d= -f2-)}"
	@echo "curl : -H \"Authorization: Bearer <GG_ADMIN_TOKEN de .env>\""

up: doctor ## Lance la stack (Redis, Postgres, backend, agent) et attend qu'elle soit prête
	@$(MAKE) --no-print-directory _core
	@$(MAKE) --no-print-directory status

up-cs2: doctor ## Lance la stack + un serveur CS2 dédié (1er lancement : ~73 Go à télécharger)
	@$(MAKE) --no-print-directory _core
	@$(COMPOSE) --profile cs2 up -d cs2
	@echo "⏳ CS2 démarre (suivre : make logs S=cs2). Le 1er lancement télécharge le jeu, compter un long moment."
	@$(MAKE) --no-print-directory status

_core:
	@$(COMPOSE) up -d --build --wait redis postgres manager
	@# node_modules du backend = volume anonyme : le renouveler depuis l'image (sinon un vieux volume masque les deps à jour)
	@$(COMPOSE) up -d --build --no-deps --renew-anon-volumes --wait backend

down: ## Arrête tous les conteneurs (les données sont conservées)
	@$(COMPOSE) --profile cs2 --profile debug down

restart: ## Redémarre un service (S=backend par défaut)
	@$(COMPOSE) restart $(or $(S),backend)

ps: ## Liste les conteneurs
	@$(COMPOSE) --profile cs2 --profile debug ps

logs: ## Suit les logs (tous, ou S=<service>)
	@$(COMPOSE) --profile cs2 --profile debug logs -f --tail=100 $(S)

status: ## Résumé de l'état et des URLs
	@echo ""
	@curl -fsS $(API)/api/health >/dev/null 2>&1 && echo "✅ Backend        $(API)/api  (health OK)" || echo "❌ Backend        $(API) ne répond pas (make logs S=backend)"
	@echo "   Sandbox        $(API)/sandbox"
	@echo "   WebSocket      ws://localhost:8081"
	@echo "   Logs agent     http://localhost:8082/logs (srv-a)"
	@echo "   Postgres       postgresql://postgres:postgres@localhost:5432/ggcore"
	@echo "   Redis          redis://localhost:6379"
	@if [ "$(CS2)" = "local" ]; then echo "   CS2 (hors Docker) attendu sur $(GG_CS2_HOST):27015 - logaddress_add_http \"http://<IP de cette machine>:8082/logs?token=$$(grep '^GG_LOGS_TOKEN=' .env | cut -d= -f2-)\" (RCON : $$(grep '^GG_RCON_PASSWORD=' .env | cut -d= -f2-))"; \
	 elif $(COMPOSE) --profile cs2 ps --services --status running 2>/dev/null | grep -qx cs2; then echo "   CS2            connect localhost:27015 (RCON $$(grep '^GG_RCON_PASSWORD=' .env | cut -d= -f2-))"; fi
	@echo ""

sandbox: ## Affiche l'URL de la Sandbox
	@echo "$(API)/sandbox"

fixtures: ## Liste les fixtures rejouables
	@ls -1 test/fixtures/raw-logs test/fixtures/scenarios

replay: ## Rejoue une fixture dans la Sandbox (F=gglan19_mirage_13-11_anonymized.log)
	@test -n "$(F)" || { echo "Usage : make replay F=<fichier de test/fixtures/raw-logs ou scenarios> (voir make fixtures)"; exit 1; }
	@case "$(F)" in *.json) ep=scenario ;; *) ep=raw-log ;; esac; \
	  curl -fsS -X POST "$(API)/sandbox/replay/$$ep" -H 'Content-Type: application/json' -H "Authorization: Bearer $(GG_ADMIN_TOKEN)" \
	    -d "{\"fixtureName\":\"$(F)\",\"matchId\":\"m-sandbox-1\",\"serverId\":\"srv-a\",\"speed\":\"instant\"}" >/dev/null \
	  && echo "✅ $(F) rejoué → $(API)/sandbox (match m-sandbox-1)" || { echo "❌ replay échoué (backend lancé ? nom correct ?)"; exit 1; }

test: test-backend test-db test-go ## Tous les tests (typecheck, Jest, intégration PostgreSQL, Go)

test-backend: ## Typecheck + suite Jest complète (dans le conteneur backend)
	@$(COMPOSE) run --rm --no-deps backend sh -c "npx --no-install prisma generate >/dev/null && npm run typecheck && npm test"

test-db: ## Test d'intégration sur un vrai PostgreSQL
	@$(COMPOSE) up -d --wait postgres
	@$(COMPOSE) run --rm --no-deps backend sh -c "npx --no-install prisma generate >/dev/null && npx --no-install prisma db push --skip-generate >/dev/null && DB_IT=1 npx --no-install jest --config jest.config.ts db.spec"

e2e-tournament: ## Scénario tournoi complet sur la stack lancée (poule, matchs auto rejoués + saisies admin, qualification, vue ASCII)
	@$(COMPOSE) exec -T backend node scripts/e2e-tournament.mjs

tournament: ## Joue un faux tournoi décrit en JSON (F=fake-gglan-32.json, dans test/fixtures/tournaments) et affiche la vue ASCII
	@test -n "$(F)" || { echo "Usage : make tournament F=<fichier de test/fixtures/tournaments>"; exit 1; }
	@$(COMPOSE) exec -T backend node scripts/tournament-scenario.mjs /test/fixtures/tournaments/$(F)

test-go: ## Build + tests de l'agent Go
	@docker run --rm -v "$(CURDIR)/agent:/src" -v ggcore-gocache:/root/.cache -v ggcore-gomod:/go/pkg/mod -w /src golang:1.23 \
	  sh -c "go build ./cmd/agent ./cmd/manager && go test ./..."

shell-backend: ## Shell dans le conteneur backend
	@$(COMPOSE) exec backend sh

psql: ## Console PostgreSQL
	@$(COMPOSE) exec postgres psql -U postgres -d ggcore

redis-cli: ## Console Redis
	@$(COMPOSE) exec redis redis-cli

reset: ## ⚠️ Supprime conteneurs ET données (base, Redis ; CS2 conservé sauf RESET_CS2=1)
	@read -p "Supprimer les données de dev (base PostgreSQL…) ? [o/N] " a; [ "$$a" = "o" ] || exit 1
	@$(COMPOSE) --profile cs2 --profile debug down --remove-orphans
	@docker volume rm -f infra_pgdata >/dev/null
	@if [ "$(RESET_CS2)" = "1" ]; then docker volume rm -f infra_cs2data >/dev/null && echo "CS2 supprimé (re-téléchargement au prochain up-cs2)"; fi
	@echo "✅ Données supprimées. make up pour repartir de zéro."
