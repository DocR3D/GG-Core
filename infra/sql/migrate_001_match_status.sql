-- Migration 001 : ajout colonne status sur la table Match
ALTER TABLE "Match"
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending'
  CHECK (status IN ('pending', 'live', 'finished'));

CREATE INDEX IF NOT EXISTS idx_match_status ON "Match"("status");
