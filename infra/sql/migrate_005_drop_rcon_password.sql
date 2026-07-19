-- Migration 005 — Suppression du mot de passe RCON
-- Le backend ne fait plus de connexions RCON directes.
-- Les commandes transitent désormais par l'API HTTP de l'agent Go (agent_port / agent_token).

ALTER TABLE "Server"
  DROP COLUMN IF EXISTS rcon_password;
