import type { BaseEvent } from './base.event';
import { EventType, EventTypes } from './event.types';
import type { CommandEvent } from './command.event';
import { GameSide } from '@app/match/state';

export type EventKind = 'primary' | 'telemetry';
export type Team = 'T' | 'CT';
export type TeamRoundWinReason = 'bomb_exploded' | 'defused' | 'elim' | 'time';

export type PlayerRefLogs = {
  name: string;
  steamId: string;
  team: GameSide;
};

// ————————————————————————————
// Core match events
// ————————————————————————————
export type RoundStartEvent = BaseEvent<typeof EventTypes.ROUND_START, {}>;
export type MatchPausedEvent = BaseEvent<typeof EventTypes.MATCH_PAUSED, {}>;
export type MatchUnpausedEvent = BaseEvent<typeof EventTypes.MATCH_UNPAUSED, {}>;

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

// ————————————————————————————
// Nouveaux events (agent Go)
// ————————————————————————————
export type ItemPurchaseEvent = BaseEvent<typeof EventTypes.ITEM_PURCHASE, {
  player: PlayerRefLogs;
  weapon: string;
}>;

export type GrenadeThrowEvent = BaseEvent<typeof EventTypes.GRENADE_THROW, {
  player: PlayerRefLogs;
  grenade: string;
  origin: { x: number; y: number; z: number };
  entindex?: string;
}>;

export type GrenadeLandEvent = BaseEvent<typeof EventTypes.GRENADE_LAND, {
  grenade: string;
  position: { x: number; y: number; z: number };
  velocity?: { x: number; y: number; z: number };
  entindex?: string;
}>;

export type PlayerBlindedEvent = BaseEvent<typeof EventTypes.PLAYER_BLINDED, {
  victim: PlayerRefLogs;
  attacker: PlayerRefLogs;
  grenade: 'flashbang';
  duration: number | string;
  entindex?: string;
}>;

export type PhaseChangeEvent = BaseEvent<typeof EventTypes.PHASE_CHANGED, {
  newPhase: string; at?: number;
}>;

export type RoundFreezeStartEvent = BaseEvent<
  typeof EventTypes.ROUND_FREEZE_START,
  {}
>;

// ————————————————————————————
export type GenericMatchEvent = BaseEvent<EventType, Record<string, any>>;

export type AnyEvent =
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
  | ItemPurchaseEvent
  | GrenadeThrowEvent
  | GrenadeLandEvent
  | PlayerBlindedEvent
  | CommandEvent
  | PhaseChangeEvent
  | RoundFreezeStartEvent
  | GenericMatchEvent;

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
  [EventTypes.ITEM_PURCHASE]: ItemPurchaseEvent;
  [EventTypes.GRENADE_THROW]: GrenadeThrowEvent;
  [EventTypes.GRENADE_LAND]: GrenadeLandEvent;
  [EventTypes.PLAYER_BLINDED]: PlayerBlindedEvent;
  [EventTypes.PHASE_CHANGED]: PhaseChangeEvent
  [EventTypes.ROUND_FREEZE_START]: RoundFreezeStartEvent;
  [EventTypes.COMMAND]: CommandEvent;
};

// ————————————————————————————
// Type guards
// ————————————————————————————
export const isTeamRoundWin = (e: AnyEvent): e is TeamRoundWinEvent =>
  e.type === EventTypes.TEAM_ROUND_WIN;
export const isRoundStart = (e: AnyEvent): e is RoundStartEvent =>
  e.type === EventTypes.ROUND_START;
export const isBombPlanted = (e: AnyEvent): e is BombPlantedEvent =>
  e.type === EventTypes.BOMB_PLANTED;
export const isSfuiTargetBombed = (e: AnyEvent): e is SfuiTargetBombedEvent =>
  e.type === EventTypes.SFUI_TARGET_BOMBED;
export const isKill = (e: AnyEvent): e is KillEvent =>
  e.type === EventTypes.KILL;
export const isPlayerConnected = (e: AnyEvent): e is PlayerConnectedEvent =>
  e.type === EventTypes.PLAYER_CONNECTED;
export const isPlayerDisconnected = (e: AnyEvent): e is PlayerDisconnectedEvent =>
  e.type === EventTypes.PLAYER_DISCONNECTED;
export const isNameChange = (e: AnyEvent): e is PlayerNameChangeEvent =>
  e.type === EventTypes.PLAYER_NAME_CHANGE;
export const isDefuseBegin = (e: AnyEvent): e is DefuseBeginEvent =>
  e.type === EventTypes.DEFUSE_BEGIN;
export const isDefuseAbort = (e: AnyEvent): e is DefuseAbortEvent =>
  e.type === EventTypes.DEFUSE_ABORT;
export const isItemPurchase = (e: AnyEvent): e is ItemPurchaseEvent =>
  e.type === EventTypes.ITEM_PURCHASE;
export const isGrenadeThrow = (e: AnyEvent): e is GrenadeThrowEvent =>
  e.type === EventTypes.GRENADE_THROW;
export const isGrenadeLand = (e: AnyEvent): e is GrenadeLandEvent =>
  e.type === EventTypes.GRENADE_LAND;
export const isPlayerBlinded = (e: AnyEvent): e is PlayerBlindedEvent =>
  e.type === EventTypes.PLAYER_BLINDED;
export const isCommand = (e: AnyEvent): e is CommandEvent =>
  e.type === EventTypes.COMMAND;
export const isRoundFreezeStart = (e: AnyEvent): e is RoundFreezeStartEvent =>
  e.type === EventTypes.ROUND_FREEZE_START;
