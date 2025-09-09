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
    
    if (!ev?.matchId) return;

    // Optionnel : ignorer les non-primaires (si tu tagges `kind: 'primary' | 'telemetry'`)
    if ((ev as any).kind && (ev as any).kind !== 'primary') {
      this.logger.debug(`skip non-primary: ${ev.type}`);
      return;
    }

    const who = ev.payload.sender.steamId ?? ev.payload.sender.name;
    const now = Date.now();
    const last = this.lastByPlayer.get(who) ?? 0;
    if (now - last < 1000) { // TODO: Configurer le délai entre deux commandes
      this.logger.debug(`Spam filtered for ${who}`);
      return;
    }
    this.lastByPlayer.set(who, now);
    
    const side = ev.payload.sender.team;
    if (side !== 'CT' && side !== 'T') return; // refuse si spectateur/unassigned

    const actor = {
      name: ev.payload.sender.name,
      steamId: ev.payload.sender.steamId,
      teamSide: side,
      channel: ev.payload.sender.channel ?? 'say',
    };

    switch (ev.payload.command) {
    case 'pause':
        {
          const side = ev.payload.sender.team as 'CT' | 'T' | undefined;
          if (side !== 'CT' && side !== 'T') return; // type guard

          await this.matchCommandService.tacticalTimeout(ev.serverId, ev.matchId, {
            name: ev.payload.sender.name,
            steamId: ev.payload.sender.steamId ?? undefined, // null -> undefined
            teamSide: side,
            channel: ev.payload.sender.channel === 'say_team' ? 'say_team' : 'say',
          });
          break;
        }

      default:
        return;
  }
}
}
