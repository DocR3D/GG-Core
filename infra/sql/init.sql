-- ============================================================
-- GG-Core — Initialisation du schéma PostgreSQL
-- Consolidé : init + migrations 001 → 005
-- ============================================================

-- ── Tournoi ──────────────────────────────────────────────────
-- id sans SERIAL : accepte les IDs de l'API externe (migration 003)
CREATE TABLE IF NOT EXISTS "Tournoi" (
    id        INT         PRIMARY KEY,
    nom       TEXT        NOT NULL,
    date      TIMESTAMPTZ NOT NULL,
    status    TEXT        NOT NULL DEFAULT 'unknown',
    game      INT,
    end_date  TIMESTAMPTZ
);

-- ── Team ─────────────────────────────────────────────────────
-- (migration 003)
CREATE TABLE IF NOT EXISTS "Team" (
    id   INT  PRIMARY KEY,
    name TEXT NOT NULL
);

-- ── TournamentTeam (liaison Tournoi ↔ Team) ──────────────────
-- (migration 003)
CREATE TABLE IF NOT EXISTS "TournamentTeam" (
    tournament_id INT NOT NULL REFERENCES "Tournoi"(id) ON DELETE CASCADE,
    team_id       INT NOT NULL REFERENCES "Team"(id)    ON DELETE CASCADE,
    PRIMARY KEY (tournament_id, team_id)
);

-- ── Player ───────────────────────────────────────────────────
-- (migration 003)
CREATE TABLE IF NOT EXISTS "Player" (
    id         INT     PRIMARY KEY,
    team_id    INT     NOT NULL REFERENCES "Team"(id) ON DELETE CASCADE,
    name       TEXT    NOT NULL,
    is_captain BOOLEAN NOT NULL DEFAULT false
);

-- ── Match ────────────────────────────────────────────────────
-- status inclus dès la création (migration 001 intégrée)
CREATE TABLE IF NOT EXISTS "Match" (
    id              SERIAL      PRIMARY KEY,
    match_redis_id  TEXT        NOT NULL,
    id_tournoi      INT         REFERENCES "Tournoi"(id) ON DELETE SET NULL,
    equipe1         TEXT        NOT NULL,
    equipe2         TEXT        NOT NULL,
    score_equipe1   INT         NOT NULL DEFAULT 0,
    score_equipe2   INT         NOT NULL DEFAULT 0,
    status          TEXT        NOT NULL DEFAULT 'pending'
                                CHECK (status IN ('pending', 'live', 'finished'))
);

-- ── MatchHistory ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "MatchHistory" (
    id                SERIAL      PRIMARY KEY,
    id_match          INT         NOT NULL REFERENCES "Match"(id) ON DELETE CASCADE,
    event_type        TEXT        NOT NULL,
    date              TIMESTAMPTZ NOT NULL DEFAULT now(),
    round             INT,
    score_equipe1     INT,
    score_equipe2     INT,
    id_ct             TEXT,
    id_t              TEXT,
    recovery_number   INT,
    data              JSONB
);

-- ── Server ───────────────────────────────────────────────────
-- server_id  : identifiant agent (ex: "srv-a"), correspond à serverId dans agents.d/*.yaml
-- agent_port : port HTTP de l'agent Go (ex: 8082), même IP que le serveur CS2
-- agent_host : host pour joindre l'agent HTTP (vide → utilise ip). Ex: "manager" en dev Docker
-- agent_token: token X-Agent-Token (vide = pas d'auth sur LAN)
-- rcon_password supprimé (migration 005) : les commandes passent par l'agent HTTP
CREATE TABLE IF NOT EXISTS "Server" (
    id          SERIAL       PRIMARY KEY,
    name        VARCHAR(100) NOT NULL,
    ip          VARCHAR(45)  NOT NULL,
    port        INTEGER      NOT NULL DEFAULT 27015,
    server_id   TEXT         UNIQUE NOT NULL DEFAULT '',
    agent_port  INTEGER      NOT NULL DEFAULT 0,
    agent_host  TEXT         NOT NULL DEFAULT '',
    agent_token TEXT         NOT NULL DEFAULT '',
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- ── Index ────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_match_redis_id           ON "Match"("match_redis_id");
CREATE INDEX IF NOT EXISTS idx_match_status             ON "Match"("status");
CREATE INDEX IF NOT EXISTS idx_match_tournoi            ON "Match"("id_tournoi");
CREATE INDEX IF NOT EXISTS idx_matchhistory_match       ON "MatchHistory"("id_match");
CREATE INDEX IF NOT EXISTS idx_matchhistory_eventtype   ON "MatchHistory"("event_type");
CREATE INDEX IF NOT EXISTS idx_player_team              ON "Player"("team_id");
CREATE INDEX IF NOT EXISTS idx_tournamentteam_tourno    ON "TournamentTeam"("tournament_id");
CREATE INDEX IF NOT EXISTS idx_tournamentteam_team      ON "TournamentTeam"("team_id");
