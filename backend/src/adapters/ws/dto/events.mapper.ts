import { EventTypes, type EventType } from '@domain/events/event.types';
import type { BaseWsEvent, WsEventType } from './events.dto';
import { fromLogsPlayerRef } from './events.dto';

// Mapper tolérant : on tape 'any' pour le payload côté domaine
export function toWsEvent(
  ev: { type: EventType; matchId: string; seq?: number; ts?: number; tick?: number; round?: number; payload?: any }
): BaseWsEvent<WsEventType, any> | null {
  const seq = ev.seq ?? ev.tick ?? 0;
  const ts  = ev.ts  ?? Date.now();
  const p   = ev.payload ?? {};

  switch (ev.type) {
    case EventTypes.ROUND_START:
      return { type: 'round:start', matchId: ev.matchId, seq, ts, payload: { round: ev.round ?? p.round ?? 0 } };

    case EventTypes.TEAM_ROUND_WIN:
      return { type: 'team_round_win', matchId: ev.matchId, seq, ts, payload: { winner: p.winner, reason: p.reason } };

    case EventTypes.KILL:
      return { type: 'kill', matchId: ev.matchId, seq, ts, payload: p };

    case EventTypes.BOMB_PLANTED:
      return { type: 'bomb:planted', matchId: ev.matchId, seq, ts, payload: {
        planter: p.planter ? fromLogsPlayerRef(p.planter) : undefined,
        site: p.site
      } };

    case EventTypes.BEGIN_BOMB_PLANT:
      return { type: 'bomb:begin', matchId: ev.matchId, seq, ts, payload: {
        player: fromLogsPlayerRef(p.player), site: p.site
      } };

    case EventTypes.DEFUSE_BEGIN:
      return { type: 'defuse:begin', matchId: ev.matchId, seq, ts, payload: {
        player: fromLogsPlayerRef(p.player), hasKit: !!p.hasKit
      } };

    case EventTypes.DEFUSE_ABORT:
      return { type: 'defuse:abort', matchId: ev.matchId, seq, ts, payload: {
        player: fromLogsPlayerRef(p.player)
      } };

    case EventTypes.PLAYER_BLINDED:
      return { type: 'player_blinded', matchId: ev.matchId, seq, ts, payload: {
        victim: fromLogsPlayerRef(p.victim),
        attacker: fromLogsPlayerRef(p.attacker),
        grenade: 'flashbang',
        duration: p.duration,
        entindex: p.entindex,
      } };

    case EventTypes.GRENADE_THROW:
      return { type: 'grenade_throw', matchId: ev.matchId, seq, ts, payload: {
        player: fromLogsPlayerRef(p.player),
        grenade: p.grenade,
        origin: p.origin,
        entindex: p.entindex,
      } };

    case EventTypes.PHASE_CHANGED:
      return { type: 'phase:changed', matchId: ev.matchId, seq, ts, payload: p };

    case EventTypes.PHASE_COUNTDOWN_CANCELLED:
      return { type: 'phase:cancelled', matchId: ev.matchId, seq, ts, payload: {} };

    case EventTypes.ROUND_FREEZE_START:
      return { type: 'phase:countdown', matchId: ev.matchId, seq, ts, payload: {} };

    case EventTypes.CHAT_MESSAGE:
      return { type: 'chat:public', matchId: ev.matchId, seq, ts, payload: p };

    case EventTypes.COMMAND:
      return { type: 'command', matchId: ev.matchId, seq, ts, payload: p };

    case EventTypes.LOG:
      return { type: 'log:raw', matchId: ev.matchId, seq, ts, payload: p };

    default:
      return null;
  }
}
