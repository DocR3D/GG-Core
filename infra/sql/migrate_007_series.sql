-- Migration 007: Series (Bo1/Bo3/Bo5) + map_number sur Match
-- À appliquer après migrate_006

-- Table Series : une série regroupe 1 à N maps d'un Bo1/Bo3/Bo5
CREATE TABLE "Series" (
    id           SERIAL      PRIMARY KEY,
    id_tournoi   INT         REFERENCES "Tournoi"(id),
    home_id      TEXT        NOT NULL,
    away_id      TEXT        NOT NULL,
    bo           INT         NOT NULL CHECK (bo IN (1, 3, 5)),
    score_home   INT         NOT NULL DEFAULT 0,  -- victoires de maps (home)
    score_away   INT         NOT NULL DEFAULT 0,  -- victoires de maps (away)
    status       TEXT        NOT NULL DEFAULT 'active'
                             CHECK (status IN ('active', 'finished')),
    winner       TEXT,                              -- 'home' | 'away' | null
    created_at   TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_series_tournoi ON "Series"("id_tournoi");
CREATE INDEX idx_series_status  ON "Series"("status");

-- Enrichissement de Match : appartenance à une série + numéro de map
ALTER TABLE "Match"
    ADD COLUMN series_id   INT REFERENCES "Series"(id),
    ADD COLUMN map_number  INT NOT NULL DEFAULT 1;

CREATE INDEX idx_match_series ON "Match"("series_id");
