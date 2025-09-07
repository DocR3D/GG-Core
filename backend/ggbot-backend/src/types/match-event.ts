/** Contrats d’événements canoniques (TS strict) */

export const EventTypes = {
  ROUND_START: 'round_start',
  BOMB_PLANTED: 'bomb_planted',
  TEAM_ROUND_WIN: 'team_round_win',
  SFUI_TARGET_BOMBED: 'sfui_notice_target_bombed',
  KILL: 'kill',
  PLAYER_CONNECTED: 'player_connect',
  PLAYER_DISCONNECTED: 'player_disconnect',
  PLAYER_NAME_CHANGE: 'name_change',
  DEFUSE_BEGIN: 'defuse_begin',
  DEFUSE_ABORT: 'defuse_abort',
  MATCH_PAUSED: 'match_paused,',
  MATCH_UNPAUSED: 'match_unpaused'
} as const;

export type EventType = typeof EventTypes[keyof typeof EventTypes];
export type KnownEventType = keyof EventByType;
export type EventKind = 'primary' | 'telemetry';
export type Team = 'T' | 'CT';
export type TeamRoundWinReason = 'bomb_exploded' | 'defused' | 'elim' | 'time';

export type PlayerRefLogs = {
  name: string;
  steamId: string;
  team: 'TERRORIST' | 'CT' | 'SPECTATOR' | 'Unassigned';
};

export type BaseEvent = {
  id?: string;
  v?: 1;
  type: EventType | (string & {}); // autorise temporairement d’autres types non typés strictement
  ts: number;
  source: 'logs' | 'cstv' | 'manual';
  kind?: EventKind;

  serverId: string;
  matchId: string;
  map?: string | null;
  round?: number | null;
  tick?: number | null;
};

export type RoundStartEvent = BaseEvent & {
  type: typeof EventTypes.ROUND_START;
  payload: Record<string, never>;
};
export type MatchPausedEvent = BaseEvent & {
  type: typeof EventTypes.MATCH_PAUSED;
  payload: Record<string, never>;
};
export type MatchUnpausedEvent = BaseEvent & {
  type: typeof EventTypes.MATCH_UNPAUSED;
  payload: Record<string, never>;
};

export type DefuseBeginEvent = BaseEvent & {
  type: typeof EventTypes.DEFUSE_BEGIN;
  payload: {
    player:PlayerRefLogs
    hasKit: boolean
  };
};
export type DefuseAbortEvent = BaseEvent & {
  type: typeof EventTypes.DEFUSE_ABORT;
  payload: {
    player:PlayerRefLogs
  };
};

export type PlayerConnectedEvent = BaseEvent & {
  type: typeof EventTypes.PLAYER_CONNECTED;
  payload: {
    player: PlayerRefLogs
  };
};
export type PlayerDisconnectedEvent = BaseEvent & {
  type: typeof EventTypes.PLAYER_DISCONNECTED;
  payload: {
    player: {
      name: string;
      steamId: string;
    }
    reason?: string;
  };
};

export type BombPlantedEvent = BaseEvent & {
  type: typeof EventTypes.BOMB_PLANTED;
  payload: {
    planter?: PlayerRefLogs;
    site?: 'A' | 'B';
  };
};

export type TeamRoundWinEvent = BaseEvent & {
  type: typeof EventTypes.TEAM_ROUND_WIN;
  payload: {
    winner: Team;
    reason?: string; // "bomb_exploded" | "defused" | "elim" | ...
  };
};

export type SfuiTargetBombedEvent = BaseEvent & {
  type: typeof EventTypes.SFUI_TARGET_BOMBED;
  payload: Record<string, never> | { reason?: 'bomb_exploded' };
};

export type PlayerNameChangeEvent = BaseEvent & {
  type: typeof EventTypes.PLAYER_NAME_CHANGE;
  payload: {
    steamId: string;
    oldName: string;
    newName: string;
  };
};

export type KillEvent = BaseEvent & {
  type: typeof EventTypes.KILL;
  payload:
    | {
        kind: 'player';
        killer: PlayerRefLogs;
        victim: PlayerRefLogs;
        weapon: string;
        headshot: boolean;
        teamkill?: boolean;
        killerPos: { x: number; y: number; z: number };
        victimPos: { x: number; y: number; z: number };
      }
    | {
        kind: 'suicide';
        player: PlayerRefLogs;
        weapon: string;
        victimPos: { x: number; y: number; z: number };
      }
    | {
        kind: 'world';
        victim: PlayerRefLogs;
        cause?: string; // 'world', 'fall', 'bomb', 'trigger_hurt', ...
        victimPos?: { x: number; y: number; z: number }; // ← rendu facultatif
      };
};

/** Fallback pour nouveaux events non encore typés strictement (facultatif mais pratique) */
export type GenericEvent = BaseEvent & {
  type: string;
  payload: Record<string, any>;
};

export type MatchEvent =
  | MatchPausedEvent
  | MatchUnpausedEvent
  | DefuseBeginEvent
  | DefuseAbortEvent
  | PlayerNameChangeEvent
  | RoundStartEvent
  | BombPlantedEvent
  | TeamRoundWinEvent
  | SfuiTargetBombedEvent
  | KillEvent
  | GenericEvent
  | KillEvent
  | PlayerConnectedEvent
  | PlayerDisconnectedEvent;

/** Map [type -> interface] pour typer les handlers stricts côté parser */
export type EventByType = {
  [EventTypes.ROUND_START]: RoundStartEvent;
  [EventTypes.BOMB_PLANTED]: BombPlantedEvent;
  [EventTypes.TEAM_ROUND_WIN]: TeamRoundWinEvent;
  [EventTypes.SFUI_TARGET_BOMBED]: SfuiTargetBombedEvent;
  [EventTypes.KILL]: KillEvent;
  [EventTypes.PLAYER_CONNECTED]: PlayerConnectedEvent;
  [EventTypes.PLAYER_DISCONNECTED]: PlayerDisconnectedEvent;
  [EventTypes.PLAYER_NAME_CHANGE]: PlayerNameChangeEvent;
  [EventTypes.DEFUSE_ABORT]: DefuseAbortEvent;
  [EventTypes.DEFUSE_BEGIN]: DefuseBeginEvent;
  [EventTypes.MATCH_PAUSED]: MatchPausedEvent;
  [EventTypes.MATCH_UNPAUSED]: MatchUnpausedEvent;

};

/** Type guards utiles côté consumers */
export const isTeamRoundWin = (e: MatchEvent): e is TeamRoundWinEvent =>
  e.type === EventTypes.TEAM_ROUND_WIN;
export const isRoundStart = (e: MatchEvent): e is RoundStartEvent =>
  e.type === EventTypes.ROUND_START;
export const isBombPlanted = (e: MatchEvent): e is BombPlantedEvent =>
  e.type === EventTypes.BOMB_PLANTED;
export const isSfuiTargetBombed = (e: MatchEvent): e is SfuiTargetBombedEvent =>
  e.type === EventTypes.SFUI_TARGET_BOMBED;
export const isKill = (e: MatchEvent): e is KillEvent =>
  e.type === EventTypes.KILL;
export const isPlayerConnected = (e: MatchEvent): e is PlayerConnectedEvent =>
  e.type === EventTypes.PLAYER_CONNECTED;
export const isPlayerDisconnected = (e: MatchEvent): e is PlayerDisconnectedEvent =>
  e.type === EventTypes.PLAYER_DISCONNECTED;
export const isNameChange = (e: MatchEvent): e is PlayerNameChangeEvent =>
  e.type === EventTypes.PLAYER_NAME_CHANGE;
export const isDefuseBegin = (e: MatchEvent): e is DefuseBeginEvent =>
  e.type === EventTypes.DEFUSE_BEGIN;
export const isDefuseAbort = (e: MatchEvent): e is DefuseAbortEvent =>
  e.type === EventTypes.DEFUSE_ABORT;