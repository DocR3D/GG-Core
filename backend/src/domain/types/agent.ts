export type AgentAction =
  | { id: string; ts: number; type: 'action'; serverId: string; action: 'pause' | 'unpause' | 'knife' | 'restart' | 'tac_timeout' | 'tech_timeout' | 'start'; payload: any; source: { via: 'chat'|'api'|'system'; player?: { name:string; steamId?:string; team?: 'CT'|'T'; channel?: 'say'|'say_team'; } } }
  // …ajoute tes actions ici

export type AgentResult = {
  correlationId: string; ts: number; serverId: string;
  action: string; ok: boolean; error?: string;
};