// ===== Contrats des événements WebSocket envoyés au frontend (alignés match.event.ts) =====

// Canonique (parser)
export type Team = 'T' | 'CT';
export type TeamFromLogs = 'TERRORIST' | 'CT' | 'SPECTATOR' | 'Unassigned';
export type TeamRoundWinReason = 'bomb_exploded' | 'defused' | 'elim' | 'time';

// Côté WS, on garde un type court + spec pour les canaux chat/overlay
export type TeamSide = Team; // 'T' | 'CT'

// —————————————————————————————————————————————————————————————————————————————
// Énum des types WS

export type WsEventType =
  | 'phase:countdown'
  | 'phase:changed'
  | 'phase:cancelled'
  | 'match:state'
  | 'score:update'
  | 'round:start'
  | 'round:end'
  | 'kill'
  | 'pause:update'
  | 'sides:swapped'
  | 'chat:public'
  | 'chat:admin'
  | 'sponsor:rotate'
  // NEW (admin/agent/debug)
  | 'command'
  | 'agent:action'
  | 'agent:result'
  | 'log:raw'
  // NEW (grenades & round win)
  | 'grenade_throw'
  | 'bomb:planted'
  | 'bomb:begin'
  | 'defuse:begin'
  | 'defuse:abort'
  | 'team_round_win'   // ← remplace 'round:win'
  | 'player_blinded';
//  | 'grenade_landed'  // activer quand prêt
//  | 'bomb:planted' | 'bomb:begin' | 'defuse:begin' | 'defuse:abort' // si tu exposes ces events

export interface BaseWsEvent<TType extends WsEventType, TPayload> {
  type: TType;
  matchId: string;
  seq: number;
  ts: number;
  payload: TPayload;
}
export type BombPlantedEvent = BaseWsEvent<'bomb:planted', {
  planter?: PlayerRef;
  site?: 'A'|'B';
}>;

export type BombBeginEvent = BaseWsEvent<'bomb:begin', {
  player: PlayerRef;
  site: 'A'|'B';
}>;

export type DefuseBeginEventWs = BaseWsEvent<'defuse:begin', {
  player: PlayerRef;
  hasKit: boolean;
}>;

export type DefuseAbortEventWs = BaseWsEvent<'defuse:abort', {
  player: PlayerRef;
}>;

// ===== Payloads communs réutilisables =====

export interface ScorePayload {
  ct: number;
  t: number;
  round: number; // round courant (1-based)
}
export type ScoreUpdateEvent = BaseWsEvent<'score:update', ScorePayload>;

export type TeamRoundWinEvent = BaseWsEvent<'team_round_win', {
  winner: 'CT' | 'T';
  reason?: 'bomb_exploded' | 'defused' | 'elim' | 'time';
}>;


// match:state — snapshot synthétique
export interface MatchStatePayload {
  teams: { home: { name: string }; away: { name: string } };
  sides: { home: TeamSide; away: TeamSide };  // mapping logique -> côté (CT/T)
  score: ScorePayload;
  timeouts?: { ct: number; t: number };       // restants
  status?: 'pending'|'warmup'|'knife'|'live'|'pause_tac'|'pause_tech'|'overtime'|'finished';
  map?: string;
  bo?: 'bo1'|'bo3'|'bo5';
}
export type MatchStateEvent = BaseWsEvent<'match:state', MatchStatePayload>;

export interface PlayerRef {
  steamId: string;
  name: string;
  team: TeamSide | 'spec'; // compat chat où un spec peut parler côté admin
}

export interface Vec3 { x: number; y: number; z: number; }
export interface Vec2N { nx: number; ny: number; }

// ===== Kills =====

export type KillPayload =
  | {
      kind: 'player';
      killer: PlayerRef;
      victim: PlayerRef;
      weapon: string;
      headshot: boolean;
      killerPos?: Vec3; victimPos?: Vec3;
      killerPosN?: Vec2N; victimPosN?: Vec2N;
    }
  | {
      kind: 'suicide';
      player: PlayerRef;
      weapon: string;
      victimPos?: Vec3; victimPosN?: Vec2N;
    }
  | {
      kind: 'world';
      victim: PlayerRef;
      cause?: string;
      victimPos?: Vec3; victimPosN?: Vec2N;
    };

// Événements lobby (listes de matchs)
export type LobbyEventType = 'matches:upsert' | 'matches:remove';
export type LobbyAdminEventType = LobbyEventType | 'matches:debug';

export interface RoundStartPayload { round: number; }
export type RoundStartEvent = BaseWsEvent<'round:start', RoundStartPayload>;

// round:end
export interface RoundEndPayload {
  round: number;
  winner: TeamSide;                  // <— aligné sur Team
  reason?: TeamRoundWinReason;       // <— mêmes libellés que match.event.ts
  scoreAfter?: ScorePayload;
}
export type RoundEndEvent = BaseWsEvent<'round:end', RoundEndPayload>;

export type KillEvent = BaseWsEvent<'kill', KillPayload>;

// pause:update (tactique/technique + état)
export interface PauseUpdatePayload {
  scope: 'tactical' | 'technical';
  state: 'requested' | 'started' | 'resumed' | 'cancelled';
  by?: TeamSide | 'server' | 'admin';
  remaining?: { ct?: number; t?: number };
}
export type PauseUpdateEvent = BaseWsEvent<'pause:update', PauseUpdatePayload>;

// sides:swapped
export interface SidesSwappedPayload {
  sides: { home: TeamSide; away: TeamSide };
  half?: number; // 1, 2, OT1, OT2...
}
export type SidesSwappedEvent = BaseWsEvent<'sides:swapped', SidesSwappedPayload>;

export interface ChatPublicPayload {
  text: string;
  channel: 'say' | 'say_team';
  player: {
    name: string;
    steamId?: string;
    team: TeamSide | 'spec';
  };
}
export type ChatPublicEvent = BaseWsEvent<'chat:public', ChatPublicPayload>;

export interface ChatAdminPayload {
  text: string;
  from?: string; // identifiant admin / système
}
export type ChatAdminEvent = BaseWsEvent<'chat:admin', ChatAdminPayload>;

export interface SponsorRotatePayload {
  sponsorId: string;
  slot?: string;
  durationMs?: number;
}
export type SponsorRotateEvent = BaseWsEvent<'sponsor:rotate', SponsorRotatePayload>;

/* ====== Events LOBBY ====== */

export interface MatchCardDTO {
  matchId: string;
  teams: { home: string; away: string };
  score: { ct: number; t: number };
  status: 'pending'|'warmup'|'knife'|'live'|'pause_tac'|'pause_tech'|'overtime'|'finished';
  round?: number;
  map?: string;
  bo?: 'bo1'|'bo3'|'bo5';
  updatedAt: string; // ISO
  hasStream?: boolean;
}

export type LobbyUpsert = {
  type: 'matches:upsert';
  payload: MatchCardDTO;
};
export type LobbyRemove = {
  type: 'matches:remove';
  payload: { matchId: string };
};
export type LobbyAdminDebug = {
  type: 'matches:debug';
  payload: any;
};

export type LobbyEvent = LobbyUpsert | LobbyRemove;
export type LobbyAdminEvent = LobbyEvent | LobbyAdminDebug;

/* ====== Grenades (nouveaux events) ====== */

// grenade_throw
export interface GrenadeThrowPayload {
  player: PlayerRef;
  grenade: string;     // 'smokegrenade' | 'flashbang' | 'hegrenade' | 'molotov' | 'incgrenade' | 'decoy'
  origin: Vec3;
  entindex?: string;   // présent pour certaines flash
}
export type GrenadeThrowEvent = BaseWsEvent<'grenade_throw', GrenadeThrowPayload>;

// player_blinded
export interface PlayerBlindedPayload {
  victim: PlayerRef;
  attacker: PlayerRef;
  grenade: 'flashbang';
  duration: number | string; // le parser envoie pour l’instant une string
  entindex?: string;
}
export type PlayerBlindedEvent = BaseWsEvent<'player_blinded', PlayerBlindedPayload>;

// // grenade_landed (optionnel, plus tard)
// export interface GrenadeLandedPayload {
//   grenade: string;
//   position: Vec3;
//   velocity?: Vec3;
//   entindex?: string;
// }
// export type GrenadeLandedEvent = BaseWsEvent<'grenade_landed', GrenadeLandedPayload>;

/* ====== Unions pratiques côté front ====== */

export type MatchWsEvent =
  | MatchStateEvent
  | ScoreUpdateEvent
  | RoundStartEvent
  | RoundEndEvent
  | KillEvent
  | PauseUpdateEvent
  | SidesSwappedEvent
  | ChatPublicEvent
  | ChatAdminEvent
  | SponsorRotateEvent
  | BombPlantedEvent
  | BombBeginEvent
  | DefuseBeginEventWs
  | DefuseAbortEventWs
  // NEW:
  | GrenadeThrowEvent
  | PlayerBlindedEvent
  | TeamRoundWinEvent; // ← ajouté ici

/* ====== Admin / Agent / Debug ====== */

export interface CommandPayload {
  command: string;
  parameters: string[];
  sender: {
    name: string;
    steamId?: string;
    team?: TeamSide | 'spec';
    channel: 'say'|'say_team';
  };
}
export type CommandWsEvent = BaseWsEvent<'command', CommandPayload>;

export interface RawLogPayload { line: string; }
export type RawLogEvent = BaseWsEvent<'log:raw', RawLogPayload>;

export interface AgentActionPayload {
  action: 'pause'|'unpause'|'knife'|'restart'|'tac_timeout'|'tech_timeout'|'start';
  source: { via: 'chat'|'api'|'system'; player?: { name:string; steamId?:string; team?:TeamSide; channel?: 'say'|'say_team' } };
  payload?: any;
}
export type AgentActionEvent = BaseWsEvent<'agent:action', AgentActionPayload>;

export interface AgentResultPayload {
  action: string;
  ok: boolean;
  error?: string;
}
export type AgentResultEvent = BaseWsEvent<'agent:result', AgentResultPayload>;

/* ===================== Helpers de mapping parser → WS ===================== */

// Mappe les valeurs team issues des logs parser (PlayerRefLogs.team)
// vers un TeamSide court ou 'spec' pour l’UI.
export const toTeamSide = (t: TeamFromLogs | TeamSide | undefined): TeamSide | 'spec' => {
  if (!t) return 'spec';
  if (t === 'CT' || t === 'T') return t;
  if (t === 'TERRORIST') return 'T';
  return 'spec'; // SPECTATOR | Unassigned
};

// PlayerRefLogs → PlayerRef (pour payloads WS)
export const fromLogsPlayerRef = (p: { name: string; steamId: string | null; team: TeamFromLogs }): PlayerRef => ({
  name: p.name,
  steamId: p.steamId ?? '',
  team: toTeamSide(p.team),
});
