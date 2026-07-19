-- Migration 004 — Port HTTP de l'agent Go par serveur
-- agent_port : port HTTP de l'agent (ex: 8082), même IP que le serveur CS2
-- agent_token : token X-Agent-Token envoyé par le backend (vide = pas d'auth)

ALTER TABLE "Server"
  ADD COLUMN IF NOT EXISTS agent_port  INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS agent_token TEXT    NOT NULL DEFAULT '';
