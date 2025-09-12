// src/application/subscribers/match-events.handler.ts
import { Injectable, Logger } from '@nestjs/common';
import { MatchStateService } from '../state/match-state.service';
import { CommandEvent } from '@domain/types/command.event';
import { MatchCommandsService } from '@app/commands/ match-commands.service';


@Injectable()
export class ChatCommandHandler {
  private readonly logger = new Logger(ChatCommandHandler.name);
  private lastByPlayer = new Map<string, number>();

  constructor(private readonly matchState: MatchStateService,private readonly matchCommandService: MatchCommandsService ) {}

  /**
   * Traite un événement "match" provenant du Pub/Sub.
   * Recommandation: ne traiter que les événements "primaires" (source de vérité),
   * pour éviter le double comptage avec les SFUI fallback.
   */
async handle(ev: CommandEvent): Promise<void> {
  this.logger.debug(`[COMMAND] reçu type=${ev.type} matchId=${ev.matchId} serverId=${ev.serverId}`);

  if (!ev?.matchId) {
    this.logger.warn(`[COMMAND] ignoré: matchId absent (serverId=${ev.serverId})`);
    return;
  }

  // Optionnel : ignorer les non-primaires (si tu tagges kind)
  if ((ev as any).kind && (ev as any).kind !== 'primary') {
    this.logger.debug(`[COMMAND] skip non-primary: type=${ev.type} kind=${(ev as any).kind}`);
    return;
  }

  const who = ev.payload.sender.steamId ?? ev.payload.sender.name;
  this.logger.debug(`[COMMAND] envoyé par ${who} (${ev.payload.sender.team}) cmd="${ev.payload.command}" params=${JSON.stringify(ev.payload.parameters)}`);

  const now = Date.now();
  const last = this.lastByPlayer.get(who) ?? 0;
  if (now - last < 1000) {
    this.logger.debug(`[COMMAND] spam filtered for ${who}, delta=${now - last}ms`);
    return;
  }
  this.lastByPlayer.set(who, now);

  const side = ev.payload.sender.team;
  if (side !== 'CT' && side !== 'T') {
    this.logger.debug(`[COMMAND] ignoré: sender.side=${side}`);
    return;
  }

  switch (ev.payload.command) {
    case 'pause': {
      const side = ev.payload.sender.team as 'CT' | 'T' | undefined;
      if (side !== 'CT' && side !== 'T') {
        this.logger.warn(`[COMMAND] pause ignoré: side=${side}`);
        return;
      }

      this.logger.debug(`[COMMAND] action=TACTICAL_TIMEOUT side=${side} matchId=${ev.matchId} serverId=${ev.serverId}`);

      await this.matchCommandService.tacticalTimeout({
        serverId: ev.serverId,
        matchId: ev.matchId,
        actor: {
          name: ev.payload.sender.name,
          steamId: ev.payload.sender.steamId ?? undefined,
          teamSide: side,
          channel: ev.payload.sender.channel === 'say_team' ? 'say_team' : 'say',
        },
        // seconds: 30, // optionnel
      });
      break;
    }

    case 'init': {
      const p = ev.payload.parameters ?? [];
      this.logger.debug(`[COMMAND] action=INIT map=${p[0]} home=${p[1]} away=${p[2]} matchId=${ev.matchId}`);
      // APRÈS (init)
      const map = p[0];
      const home = (p[1] === 'CT' || p[1] === 'T') ? (p[1] as 'CT'|'T') : 'CT';
      const away = (p[2] === 'CT' || p[2] === 'T') ? (p[2] as 'CT'|'T') : 'T';
      const res = await this.matchCommandService.ensureInitMatch(
        ev.serverId,
        ev.matchId ?? undefined,
        { home, away },
      );

      // Si un nom de map a été fourni, switch de map via l’agent
      if (map) {
        await this.matchCommandService.changeLevel({ serverId: ev.serverId, map });
      }
      break;
    }

    default:
      this.logger.debug(`[COMMAND] ignoré: commande inconnue "${ev.payload.command}"`);
      return;
  }
}

}
