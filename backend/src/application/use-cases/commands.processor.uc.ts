import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import Redis, { RedisOptions } from 'ioredis';
import { MatchStateService } from '@app/match/state/match-state.service';
import { REDIS_CMD, REDIS_PUB } from '@adapters/redis/redis.tokens';
import { CommandEvent} from '@domain/types/command.event';

type AgentAction = {
  type: 'action';
  serverId: string;
  action: string;
  payload?: Record<string, any>;
  source?: {
    player?: { name: string; steamId?: string | null; team?: string };
    via?: 'chat' | 'admin' | 'api';
    reason?: string;
  };
  ts: number;
};

const baseRedisOptions: RedisOptions = {
      lazyConnect: true,
  // Fix #1: évite le crash "Stream isn't writeable..."
  enableOfflineQueue: true,
  autoResendUnfulfilledCommands: true,
  maxRetriesPerRequest: null,
  retryStrategy: (times) => Math.min(500 + times * 250, 2_000),
};

@Injectable()
export class CommandsProcessorService{
  private readonly logger = new Logger(CommandsProcessorService.name);

  constructor(
    @Inject(REDIS_PUB) private readonly pub: Redis,
    private readonly matchState: MatchStateService,private readonly ms: MatchStateService) {}
  // anti-spam (1s par joueur)
  private lastByPlayer = new Map<string, number>();

  private async onCommand(message: string) {
    let cmd: CommandEvent;
    try {
      cmd = JSON.parse(message);
    } catch {
      this.logger.warn('Invalid command json');
      return;
    }

    // 1) anti-spam 1s/joueur
    const who = cmd.payload.sender.steamId ?? cmd.payload.sender.name;
    const now = Date.now();
    const last = this.lastByPlayer.get(who) ?? 0;
    if (now - last < 1000) {
      this.logger.debug(`Spam filtered for ${who}`);
      return;
    }
    this.lastByPlayer.set(who, now);

    const side = (cmd.payload.sender.team || '').toUpperCase(); // "CT" | "T" | ...
    const channel = cmd.payload.sender.channel;
    const mapped = this.mapCommandToAction(cmd.payload.sender.name, cmd.payload.parameters, side, channel);
    if (!mapped) {
      this.logger.debug(`Command ignored: ${cmd.payload.sender}`);
      return;
    }

    // 2) Résoudre matchId depuis serverId
    const matchId = await this.ms.getMatchIdFromServerId(cmd.serverId);
    if (!matchId) {
      this.logger.warn(`No match bound to server ${cmd.serverId} — refusing command ${mapped.action}`);
      return;
    }

    // 3) Charger sides (CT/T) pour convertir en équipe logique home/away
    const sides = await this.ms.getSides(matchId);
    if (!sides) {
      this.logger.warn(`No sides set for match ${matchId} — refusing command ${mapped.action}`);
      return;
    }
    const logicalTeam: 'home' | 'away' =
      side === sides.home ? 'home' : 'away';

    // 4) Règles métier : décrément tac si pause tactique
    if (mapped.action === 'pause' && mapped.payload?.kind === 'tac') {
      const remain = await this.ms.decrTac(matchId, logicalTeam);
      if (remain < 0) {
        this.logger.warn(`Timeouts hash missing for match ${matchId} — init before using tac`);
        return;
      }
      if (remain === 0) {
        this.logger.log(`No tactical timeouts left for ${logicalTeam} on match ${matchId}`);
        return;
      }
      this.logger.log(`TAC used by ${logicalTeam} on ${matchId}, remaining=${remain}`);
    }

    // 5) Publication vers l’agent Go (enrichie avec matchId + teamLogical)
    const agentMsg: AgentAction = {
      type: 'action',
      serverId: cmd.serverId,
      action: mapped.action,
      payload: {
        ...mapped.payload,
        matchId,
        teamLogical: logicalTeam, // home/away
        teamSide: side,           // CT/T (au moment de la commande)
      },
      source: {
        via: 'chat',
        player: {
          name: cmd.payload.sender.name,
          steamId: cmd.payload.sender.steamId,
          team: side,
        },
      },
      ts: now,
    };

    await this.pub.publish('ggbot:agent:actions', JSON.stringify(agentMsg));
    this.logger.log(`[to-agent] ${agentMsg.action} -> ${cmd.serverId} (match=${matchId}, team=${logicalTeam})`);
  }

  private mapCommandToAction(
    name: string,
    args: string[],
    teamSide: string,
    channel: 'say' | 'say_team',
  ): { action: string; payload?: Record<string, any> } | null {
    const n = name.toLowerCase();

    // Exemple de règle: tacs via say_team de préférence (assoupli si besoin)
    const requireTeamChatForTac = false; // passe à true si tu veux forcer say_team
    if (requireTeamChatForTac && (n === 'tac' || n === 'pause' || n === 'timeout') && channel !== 'say_team') {
      return null;
    }

    if (n === 'pause' || n === 'timeout' || n === 'tac') {
      return { action: 'pause', payload: { kind: 'tac', teamSide, seconds: this.parseSeconds(args, 30) } };
    }
    if (n === 'tech') {
      return { action: 'pause', payload: { kind: 'tech', teamSide } };
    }
    if (n === 'unpause') {
      return { action: 'unpause', payload: { teamSide } };
    }
    if (n === 'start') {
      return { action: 'start_match' };
    }
    if (n === 'knife') {
      return { action: 'start_knife' };
    }
    if (n === 'restart') {
      return { action: 'restart_game' };
    }
    if (n === 'ready') {
      return { action: 'ready', payload: { teamSide } };
    }
    if (n === 'unready') {
      return { action: 'unready', payload: { teamSide } };
    }

    return null;
  }
private parseSeconds(args: string[], def: number): number {
    const s = parseInt(args[0] ?? '', 10);
    return Number.isFinite(s) && s > 0 && s < 600 ? s : def;
  }



}
