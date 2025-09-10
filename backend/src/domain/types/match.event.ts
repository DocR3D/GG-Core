// match.event.ts
import type { BaseEvent } from './base.event';
import { EventTypes } from './event.types';

/** Contrats d’événements canoniques (TS strict) */

export type EventKind = 'primary' | 'telemetry';
export type Team = 'T' | 'CT';
export type TeamRoundWinReason = 'bomb_exploded' | 'defused' | 'elim' | 'time';

export type PlayerRefLogs = {
  name: string;
  steamId: string;
  team: 'TERRORIST' | 'CT' | 'SPECTATOR' | 'Unassigned';
};

export type RoundStartEvent = BaseEvent<typeof EventTypes.ROUND_START, {}>;
export type MatchPausedEvent = BaseEvent<typeof EventTypes.MATCH_PAUSED, {}>;
export type MatchUnpausedEvent = BaseEvent<typeof EventTypes.MATCH_UNPAUSED, {}>;
export type CommandEvent = BaseEvent<typeof EventTypes.COMMAND, {
  command: string;
  parameters: string[];
  sender: {
    name: string;
    steamId: string | null;
    team: 'T' | 'CT' | 'SPECTATOR' | 'Unassigned'; // tu peux réduire à 'T'|'CT' si tu préfères
    channel: 'say' | 'say_team';
  };
}>;
export type DefuseBeginEvent = BaseEvent<typeof EventTypes.DEFUSE_BEGIN, {
  player: PlayerRefLogs;
  hasKit: boolean;
}>;
export type DefuseAbortEvent = BaseEvent<typeof EventTypes.DEFUSE_ABORT, {
  player: PlayerRefLogs;
}>;

export type PlayerConnectedEvent = BaseEvent<typeof EventTypes.PLAYER_CONNECTED, {
  player: PlayerRefLogs;
}>;
export type PlayerDisconnectedEvent = BaseEvent<typeof EventTypes.PLAYER_DISCONNECTED, {
  player: { name: string; steamId: string };
  reason?: string;
}>;

export type PlayerNameChangeEvent = BaseEvent<typeof EventTypes.PLAYER_NAME_CHANGE, {
  steamId: string;
  oldName: string;
  newName: string;
}>;

export type BombPlantedEvent = BaseEvent<typeof EventTypes.BOMB_PLANTED, {
  planter?: PlayerRefLogs;
  site?: 'A' | 'B';
}>;

export type TeamRoundWinEvent = BaseEvent<typeof EventTypes.TEAM_ROUND_WIN, {
  winner: Team;
  reason?: TeamRoundWinReason;
}>;

export type SfuiTargetBombedEvent = BaseEvent<typeof EventTypes.SFUI_TARGET_BOMBED, {
  reason?: 'bomb_exploded';
}>;

export type RoundStatsEvent = BaseEvent<typeof EventTypes.ROUND_STATS, {
  round: number; score_t: number; score_ct: number; map: string; server: string;
  players: Array<Record<string, string|number>>;
}>;

export type KillEvent = BaseEvent<typeof EventTypes.KILL,
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
      cause?: string;
      victimPos?: { x: number; y: number; z: number };
    }
>;

/** Catch-all (compat / debug) */
export type GenericMatchEvent = BaseEvent<string, Record<string, any>>;

export type MatchEvent =
  | RoundStartEvent
  | MatchPausedEvent
  | MatchUnpausedEvent
  | DefuseBeginEvent
  | DefuseAbortEvent
  | PlayerConnectedEvent
  | PlayerDisconnectedEvent
  | PlayerNameChangeEvent
  | BombPlantedEvent
  | TeamRoundWinEvent
  | SfuiTargetBombedEvent
  | KillEvent
  | RoundStatsEvent
  | CommandEvent
  | GenericMatchEvent;

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
  [EventTypes.COMMAND]: CommandEvent;

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
export const isCommand = (e: MatchEvent): e is CommandEvent =>
  e.type === EventTypes.COMMAND;
