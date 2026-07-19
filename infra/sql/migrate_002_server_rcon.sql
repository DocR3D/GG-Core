-- Migration 002 — Ajout server_id (liaison agent) + rcon_password à la table Server
-- server_id : identifiant textuel de l'agent (ex: "srv-a"), correspond à serverId dans agents.d/*.yaml
-- rcon_password : mot de passe RCON utilisé par le probe backend

ALTER TABLE "Server"
  ADD COLUMN IF NOT EXISTS server_id    TEXT UNIQUE NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS rcon_password TEXT        NOT NULL DEFAULT '';
