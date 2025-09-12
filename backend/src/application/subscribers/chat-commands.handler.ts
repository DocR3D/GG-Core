// src/application/subscribers/chat-commands.handler.ts
import { Injectable, Logger } from '@nestjs/common';
import { MatchStateService } from '../state/match-state.service';
import { MatchCommandsService } from '@app/commands/match-commands.service';
import { CommandEvent } from '@domain/types/command.event';

type TeamSide = 'CT' | 'T';
type Channel = 'say' | 'say_team';

const CMD_COOLDOWN_MS = 1000;
const ALLOWED = new Set([
  'pause','unpause','tech','tac','start','knife','stop','ready','unready','timeout','restart','init'
]);

@Injectable()
export class ChatCommandHandler {
  private readonly logger = new Logger(ChatCommandHandler.name);
  /** key = `${matchId}:${steamIdOrName}` -> lastTs */
  private lastByPlayer = new Map<string, number>();

  constructor(
    private readonly matchState: MatchStateService,
    private readonly matchCommandService: MatchCommandsService,
  ) {}

  private key(matchId: string, who: string) { return `${matchId}:${who}`; }
  private normTeam(t: any): TeamSide | 'spec' {
    if (t === 'CT') return 'CT';
    if (t === 'T' || t === 'TERRORIST') return 'T';
    return 'spec';
  }
  private normChan(c: any): Channel { return c === 'say_team' ? 'say_team' : 'say'; }

  async handle(ev: CommandEvent): Promise<void> {
    if (!ev?.matchId) {
      this.logger.warn(`[COMMAND] ignored: missing matchId (serverId=${ev?.serverId ?? '∅'})`);
      return;
    }
    // ignore télémétrie si jamais
    if ((ev as any).kind && (ev as any).kind !== 'primary') return;

    const sender = ev.payload?.sender;
    const command = (ev.payload?.command || '').toLowerCase();
    const params  = ev.payload?.parameters ?? [];
    if (!sender || !command) {
      this.logger.warn('[COMMAND] ignored: bad payload');
      return;
    }

    if (!ALLOWED.has(command)) {
      this.logger.debug(`[COMMAND] ignored not-allowed "${command}"`);
      return;
    }

    const side  = this.normTeam(sender.team);
    const chan  = this.normChan(sender.channel);
    const who   = sender.steamId ?? sender.name ?? 'unknown';
    const k     = this.key(ev.matchId, who);

    // cooldown par match + joueur
    const now = Date.now();
    const last = this.lastByPlayer.get(k) ?? 0;
    if (now - last < CMD_COOLDOWN_MS) {
      this.logger.debug(`[COMMAND] spam filtered ${who} Δ=${now-last}ms cmd="${command}"`);
      return;
    }
    this.lastByPlayer.set(k, now);

    // seules les équipes actives peuvent lancer la plupart des commandes
    if (side === 'spec' && command !== 'init') {
      this.logger.debug(`[COMMAND] ignored from spectator: ${who} cmd=${command}`);
      return;
    }

    this.logger.debug(`[COMMAND] ${command} by=${who} team=${side} chan=${chan} params=${JSON.stringify(params)} match=${ev.matchId}`);

    // ————— Dispatch commandes —————
    switch (command) {
      case 'pause':
      case 'tac':
      case 'timeout': {
        await this.matchCommandService.tacticalTimeout({
          serverId: ev.serverId,
          matchId: ev.matchId,
          actor: { name: sender.name, steamId: sender.steamId ?? undefined, teamSide: side as TeamSide, channel: chan },
        });
        break;
      }
      case 'tech': {
        await this.matchCommandService.technicalTimeout({
          serverId: ev.serverId,
          matchId: ev.matchId,
          actor: { name: sender.name, steamId: sender.steamId ?? undefined, teamSide: side as TeamSide, channel: chan },
        });
        break;
      }
      case 'unpause': {
        await this.matchCommandService.unpause({
          serverId: ev.serverId,
          matchId: ev.matchId,
          actor: { name: sender.name, steamId: sender.steamId ?? undefined, teamSide: side as TeamSide, channel: chan },
        });
        break;
      }
      case 'start': {
        await this.matchCommandService.startLive({
          serverId: ev.serverId,
          matchId: ev.matchId,
          actor: { name: sender.name, steamId: sender.steamId ?? undefined, teamSide: side as TeamSide, channel: chan },
        });
        break;
      }
      case 'knife': {
        await this.matchCommandService.startKnife({
          serverId: ev.serverId,
          matchId: ev.matchId,
          actor: { name: sender.name, steamId: sender.steamId ?? undefined, teamSide: side as TeamSide, channel: chan },
        });
        break;
      }
      case 'restart': {
        await this.matchCommandService.restartGame({
          serverId: ev.serverId,
          matchId: ev.matchId,
          actor: { name: sender.name, steamId: sender.steamId ?? undefined, teamSide: side as TeamSide, channel: chan },
        });
        break;
      }
      case 'ready': {
        await this.matchCommandService.setReady({
          serverId: ev.serverId,
          matchId: ev.matchId,
          actor: { name: sender.name, steamId: sender.steamId ?? undefined, teamSide: side as TeamSide, channel: chan },
          ready: true,
        });
        break;
      }
      case 'unready': {
        await this.matchCommandService.setReady({
          serverId: ev.serverId,
          matchId: ev.matchId,
          actor: { name: sender.name, steamId: sender.steamId ?? undefined, teamSide: side as TeamSide, channel: chan },
          ready: false,
        });
        break;
      }
      case 'stop': {
        await this.matchCommandService.stopMatch({
          serverId: ev.serverId,
          matchId: ev.matchId,
          actor: { name: sender.name, steamId: sender.steamId ?? undefined, teamSide: side as TeamSide, channel: chan },
        });
        break;
      }
      case 'init': {
        const p = ev.payload.parameters ?? [];
        // normalise une side
        const toSide = (s?: string): 'CT'|'T'|undefined => {
          if (!s) return undefined;
          const u = s.toUpperCase();
          if (u === 'CT') return 'CT';
          if (u === 'T' || u === 'TERRORIST') return 'T';
          return undefined;
        };

        let matchIdParam: string | undefined;
        let map: string | undefined;
        let home: 'CT'|'T' = 'CT';
        let away: 'CT'|'T' = 'T';

        if (p.length >= 4) {
          // !init <matchId> <map> <home> <away>
          matchIdParam = p[0];
          map = p[1];
          home = toSide(p[2]) ?? 'CT';
          away = toSide(p[3]) ?? (home === 'CT' ? 'T' : 'CT');
        } else if (p.length === 3) {
          // !init <map> <home> <away>
          map = p[0];
          home = toSide(p[1]) ?? 'CT';
          away = toSide(p[2]) ?? 'T';
        } else if (p.length === 2) {
          // !init <home> <away>  (sans map)
          home = toSide(p[0]) ?? 'CT';
          away = toSide(p[1]) ?? 'T';
        } // sinon: defaults

        this.logger.debug(
          `[COMMAND] action=INIT matchIdParam=${matchIdParam ?? '∅'} map=${map ?? '∅'} home=${home} away=${away} matchId=${ev.matchId}`
        );

        // on passe le matchId param s’il existe, sinon on garde ev.matchId
        await this.matchCommandService.ensureInitMatch(
          ev.serverId,
          matchIdParam ?? ev.matchId ?? undefined,
          { home, away },
          { map }
        );

        // on pilote l’agent pour changer de map si fourni
        if (map) {
          await this.matchCommandService.changeLevel({ serverId: ev.serverId, map });
        }
        break;
      }
      default:
        // ne devrait pas arriver grâce à ALLOWED, on garde un log
        this.logger.debug(`[COMMAND] unhandled "${command}"`);
    }
  }
}
