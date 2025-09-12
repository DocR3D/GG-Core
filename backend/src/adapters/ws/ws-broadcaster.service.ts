// ws-broadcaster.ts
import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS_SUB } from '@adapters/redis/redis.tokens';
import { RealtimeEmitter } from './realtime.emitter';
import { SeqService } from '@app/state/seq.service';
import { MatchStateService } from '@app/state/match-state.service';

import type { Audience, InternalEvent } from '@domain/types/internal-events';
import type {
  BaseWsEvent,
  WsEventType,
  ChatPublicEvent,
  CommandWsEvent,
} from './dto/events.dto';

type RawBusEvent = {
  v?: number;
  id?: string;
  timestamp?: number;
  type?: string;               // ex: "chat_message"
  matchId?: string;
  serverId?: string;
  source?: 'logs' | 'api' | 'system' | 'agent';
  kind?: 'primary' | 'telemetry';
  payload?: any;
  audience?: Audience;
  // si c'est déjà un InternalEvent:
  name?: InternalEvent['name'];
  ts?: number;
  seq?: number;
};

@Injectable()
export class WsBroadcaster implements OnModuleInit {
  private readonly logger = new Logger(WsBroadcaster.name);

  constructor(
    @Inject(REDIS_SUB) private readonly sub: Redis,
    private readonly emitter: RealtimeEmitter,
    private readonly seq: SeqService,
    private readonly matchState: MatchStateService,
  ) {}

  async onModuleInit() {
    await this.sub.subscribe('ggbot:events');
    this.logger.log('✅ Subscribed to Redis channel: ggbot:events');

    // mappe bus.type -> InternalEvent.name
    const mapTypeToName = (t?: string): InternalEvent['name'] | undefined => {
      switch (t) {
        case 'chat_message':        return 'CHAT_PUBLIC';
        case 'command':             return 'COMMAND';
        case 'round_start':         return 'ROUND_START';
        case 'round_end':           return 'ROUND_END';
        case 'score_update':        return 'SCORE_UPDATE';
        case 'pause_update':        return 'PAUSE_UPDATE';
        case 'sides_swapped':       return 'SIDES_SWAPPED';
        case 'match_state':         return 'MATCH_STATE';
        case 'kill':                return 'KILL';
        case 'agent:action':        return 'AGENT_ACTION';
        case 'agent:result':        return 'AGENT_RESULT';
        case 'log:raw':             return 'LOG_RAW';

        // Nouveaux événements “primaires” du parser Go
        case 'team_round_win':      return 'TEAM_ROUND_WIN';
        case 'bomb_planted':        return 'BOMB_PLANTED';
        case 'begin_bomb_plant':    return 'BEGIN_BOMB_PLANT';
        case 'defuse_begin':        return 'DEFUSE_BEGIN';
        case 'defuse_abort':        return 'DEFUSE_ABORT';
        case 'match_paused':        return 'MATCH_PAUSED';
        case 'match_unpaused':      return 'MATCH_UNPAUSED';
        case 'player_connected':    return 'PLAYER_CONNECTED';
        case 'player_disconnected': return 'PLAYER_DISCONNECTED';
        case 'player_name_change':  return 'PLAYER_NAME_CHANGE';
        case 'item_purchase':       return 'ITEM_PURCHASE';
        case 'grenade_throw':       return 'GRENADE_THROW';
        case 'grenade_landed':      return 'GRENADE_LAND';
        case 'player_blinded':      return 'PLAYER_BLINDED';
        case 'sfui_target_bombed':  return 'SFUI_TARGET_BOMBED';
        default:                    return undefined;
      }
    };

    // audience par défaut par type interne
    const defaultAudience = (name: InternalEvent['name']): Audience =>
      (name === 'CHAT_PUBLIC' || name === 'CHAT_ADMIN' || name === 'COMMAND'
        || name === 'AGENT_ACTION' || name === 'AGENT_RESULT' || name === 'LOG_RAW')
        ? 'admin'
        : 'both';

    this.sub.on('message', async (_channel, raw) => {
      const recvAt = Date.now();

      let base: RawBusEvent;
      try {
        base = JSON.parse(raw);
      } catch (e) {
        this.logger.warn(`⚠️ Invalid JSON: ${(e as Error).message}`);
        return;
      }

      if (!base?.type && ((base as any).rcon || (base as any).logs)) {
        //this.logger.debug('ignored agent heartbeat on ggbot:events');
        return;
      }
      if (!base?.type && !base?.name) {
        // rien à mapper, message non match => on ignore proprement
        return;
      }
      if (!base.matchId || base.matchId === 'unknown') {
          const sid = typeof base.serverId === 'string' && base.serverId.trim() ? base.serverId : null;
          if ((!base.matchId || base.matchId === 'unknown') && sid) {
            try {
              const mid = await this.matchState.getServerMatch(sid); // sid est string ici
              if (mid) base.matchId = mid; // getServerMatch: Promise<string | null>
            } catch {}
          }
      }
      this.logger.debug(`📩 RX on ${_channel}: ${raw.slice(0, 240)}${raw.length > 240 ? '…' : ''}`);

      // ——— Normalisation → InternalEvent ———
      let ev: InternalEvent | null;
      if (base?.name) {
        // déjà un InternalEvent
        ev = base as InternalEvent;
        ev.ts = ev.ts ?? base.timestamp ?? Date.now();
        ev.audience = ev.audience ?? defaultAudience(ev.name);
      } else {
        const name = mapTypeToName(base.type);
        if (!name) {
          this.logger.warn(`❓ Unmapped bus event type="${base.type ?? '∅'}"`);
          return;
        }
        ev = {
          v: 1,
          id: base.id,
          name,
          audience: base.audience ?? defaultAudience(name),
          serverId: base.serverId ?? 'unknown',
          matchId: base.matchId ?? 'unknown',
          map: null,
          round: null,
          tick: null,
          ts: base.timestamp ?? Date.now(),
          source: base.source ?? 'agent',
          kind: base.kind ?? 'primary',
          payload: base.payload,
        } as InternalEvent;
      }

      // assure l’ordre & l’horodatage
      ev.seq = ev.seq ?? await this.seq.next(ev.matchId);
      ev.ts = ev.ts ?? Date.now();

      const toPublic = ev.audience === 'public' || ev.audience === 'both';
      const toAdmin  = ev.audience === 'admin'  || ev.audience === 'both';

      const send = (eventName: WsEventType, payload: any = ev) => {
        if (toPublic) this.logger.verbose(`🛰️  → WS public[${ev!.matchId}] "${eventName}"`);
        if (toAdmin)  this.logger.verbose(`🛰️  → WS admin [${ev!.matchId}] "${eventName}"`);
        if (toPublic) this.emitter.emitPublic(ev!.matchId, eventName, payload);
        if (toAdmin)  this.emitter.emitAdmin (ev!.matchId, eventName, payload);
      };

      switch (ev.name) {
        case 'KILL':              send('kill'); break;
        case 'ROUND_START':       send('round:start'); break;
        case 'ROUND_END':         send('round:end'); break;
        case 'SCORE_UPDATE':      send('score:update'); break;
        case 'PAUSE_UPDATE':      send('pause:update'); break;
        case 'SIDES_SWAPPED':     send('sides:swapped'); break;
        case 'MATCH_STATE':       send('match:state'); break;

        // ✅ corriger l’event WS pour coller à events.dto.ts
        case 'TEAM_ROUND_WIN':    send('team_round_win'); break;

        // Bomb / defuse
        case 'BOMB_PLANTED':      send('bomb:planted', asWs('bomb:planted' as WsEventType, ev, ev.payload, ev.seq!, ev.ts!)); break;
        case 'BEGIN_BOMB_PLANT':  send('bomb:begin',    asWs('bomb:begin'    as WsEventType, ev, ev.payload, ev.seq!, ev.ts!)); break;
        case 'DEFUSE_BEGIN':      send('defuse:begin',  asWs('defuse:begin'  as WsEventType, ev, ev.payload, ev.seq!, ev.ts!)); break;
        case 'DEFUSE_ABORT':      send('defuse:abort',  asWs('defuse:abort'  as WsEventType, ev, ev.payload, ev.seq!, ev.ts!)); break;

        // Pause explicite (si l’agent envoie match_paused/unpaused)
        case 'MATCH_PAUSED':      send('pause:update',  asWs('pause:update'  as WsEventType, ev, { state: 'paused' },   ev.seq!, ev.ts!)); break;
        case 'MATCH_UNPAUSED':    send('pause:update',  asWs('pause:update'  as WsEventType, ev, { state: 'unpaused' }, ev.seq!, ev.ts!)); break;

        // Grenades / blinded
        case 'GRENADE_THROW':     send('grenade_throw'); break;
        case 'GRENADE_LAND':      send('grenade_landed' as any /* ajoute-le si tu l’as dans WsEventType */); break;
        case 'PLAYER_BLINDED':    send('player_blinded'); break;

        // Divers joueurs / achats
        case 'PLAYER_CONNECTED':    send('player:connected'  as any); break;
        case 'PLAYER_DISCONNECTED': send('player:disconnected' as any); break;
        case 'PLAYER_NAME_CHANGE':  send('player:name_change' as any); break;
        case 'ITEM_PURCHASE':       send('item:purchase'      as any); break;

        // SFUI bombed (fallback rare, utile overlay)
        case 'SFUI_TARGET_BOMBED':  send('sfui:target_bombed' as any); break;

        case 'CHAT_PUBLIC': {
          if (!toAdmin) break;
          const p = ev.payload as {
            channel: 'say'|'say_team';
            message: string;
            player: { name: string; steamId: string|null; team: string };
          };
          const dto: ChatPublicEvent = asWs('chat:public', ev, {
            text: p.message,
            channel: p.channel,
            player: {
              name: p.player.name,
              steamId: p.player.steamId ?? undefined,
              team: toTeamSide(p.player.team),
            },
          }, ev.seq!, ev.ts!);
          this.emitter.emitAdmin(ev.matchId, 'chat:public', dto);
          break;
        }

        case 'COMMAND': {
          if (!toAdmin) break;
          const p = ev.payload as {
            command: string; parameters: string[];
            sender: { name:string; steamId:string|null; team:string; channel:'say'|'say_team' };
          };
          const dto: CommandWsEvent = asWs('command', ev, {
            command: p.command,
            parameters: p.parameters,
            sender: {
              name: p.sender.name,
              steamId: p.sender.steamId ?? undefined,
              team: toTeamSide(p.sender.team),
              channel: p.sender.channel,
            },
          }, ev.seq!, ev.ts!);
          this.emitter.emitAdmin(ev.matchId, 'command', dto);
          break;
        }

        case 'AGENT_ACTION': send('agent:action'); break;
        case 'AGENT_RESULT': send('agent:result'); break;
        case 'LOG_RAW':      send('log:raw'); break;

        default:
          this.logger.warn(`❓ Unhandled InternalEvent name: ${ev.name}`);
      }

      this.logger.debug(`✅ Handled ${ev.name}#${ev.seq} (match=${ev.matchId}) in ${Date.now()-recvAt}ms`);
    });
  }
}

// ————— Helpers —————

function toTeamSide(team: string): 'CT'|'T'|'spec' {
  if (team === 'CT') return 'CT';
  if (team === 'T' || team === 'TERRORIST') return 'T';
  return 'spec';
}

function asWs<TType extends WsEventType, TPayload>(
  type: TType,
  ev: InternalEvent,
  payload: TPayload,
  seq: number,
  ts: number
): BaseWsEvent<TType, TPayload> {
  return { type, matchId: ev.matchId, seq, ts, payload };
}
