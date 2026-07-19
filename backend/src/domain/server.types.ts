// src/domain/server.types.ts

export type ServerStatus = 'offline' | 'start' | 'used';

export type ServerRow = {
  id: number;
  server_id: string;   // identifiant agent (ex: "srv-a"), clé Redis
  name: string;
  ip: string;
  port: number;
  agent_port: number;  // port HTTP de l'agent Go (ex: 8082), 0 = non configuré
  agent_host: string;  // host pour joindre l'agent HTTP (vide → utilise ip). Ex: "manager" en dev Docker
  agent_token: string; // token X-Agent-Token (jamais exposé en API)
  created_at: Date;
};

export type ServerDto = Omit<ServerRow, 'agent_token'> & {
  status: ServerStatus;
  currentMatchId: string | null;
};
