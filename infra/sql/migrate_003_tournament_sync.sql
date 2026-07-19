-- ============================================================
-- Migration 003 — Persistance PostgreSQL des tournois synchés
-- ============================================================
-- Exécuter APRÈS init.sql + migrations 001/002
-- Idempotent (IF NOT EXISTS / IF EXISTS)
-- ============================================================

-- 1. Supprime le SERIAL de Tournoi.id pour accepter les IDs de l'API externe
ALTER TABLE "Tournoi" ALTER COLUMN id DROP DEFAULT;
DROP SEQUENCE IF EXISTS "Tournoi_id_seq" CASCADE;

-- 2. Colonnes manquantes dans Tournoi
ALTER TABLE "Tournoi"
  ADD COLUMN IF NOT EXISTS status   TEXT        NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS game     INT,
  ADD COLUMN IF NOT EXISTS end_date TIMESTAMPTZ;

-- 3. Table Team
CREATE TABLE IF NOT EXISTS "Team" (
    id      INT  PRIMARY KEY,
    name    TEXT NOT NULL
);

-- 4. Table de liaison Tournoi ↔ Team (many-to-many)
CREATE TABLE IF NOT EXISTS "TournamentTeam" (
    tournament_id INT NOT NULL REFERENCES "Tournoi"(id) ON DELETE CASCADE,
    team_id       INT NOT NULL REFERENCES "Team"(id)    ON DELETE CASCADE,
    PRIMARY KEY (tournament_id, team_id)
);

-- 5. Table Player
CREATE TABLE IF NOT EXISTS "Player" (
    id         INT     PRIMARY KEY,
    team_id    INT     NOT NULL REFERENCES "Team"(id) ON DELETE CASCADE,
    name       TEXT    NOT NULL,
    is_captain BOOLEAN NOT NULL DEFAULT false
);

-- 6. Index
CREATE INDEX IF NOT EXISTS idx_player_team              ON "Player"("team_id");
CREATE INDEX IF NOT EXISTS idx_tournamentteam_tourno    ON "TournamentTeam"("tournament_id");
CREATE INDEX IF NOT EXISTS idx_tournamentteam_team      ON "TournamentTeam"("team_id");
