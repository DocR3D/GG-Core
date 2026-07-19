-- Migration 006 — Ajout agent_host sur Server
-- agent_host : host pour joindre l'agent HTTP (vide → utilise ip).
-- Utile en dev Docker où le backend doit atteindre l'agent via le réseau Docker interne
-- plutôt que par l'IP LAN du host (ex: agent_host = "manager" pour le service Compose).
-- En prod LAN, laisser vide : le backend utilise ip:agent_port.

ALTER TABLE "Server"
  ADD COLUMN IF NOT EXISTS agent_host TEXT NOT NULL DEFAULT '';
