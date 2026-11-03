// src/application/sponsors/sponsor-chat-announcer.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { SponsorService } from './sponsor.service';
import { MatchCommandsService } from '@app/commands/match-commands.service';
import { MatchStateService } from '@app/match/state/match-state.service';
import { PrismaService } from '@adapters/database/prisma.service';
import { MatchPhase } from '@domain/phase.types';
import type { Sponsor } from '@prisma/client';

export interface AnnounceSponsorOptions {
  sponsorId?: string;
  prefix?: string;
  customMessage?: string;
}

@Injectable()
export class SponsorChatAnnouncerService {
  private readonly logger = new Logger(SponsorChatAnnouncerService.name);
  private enabled = true;
  private defaultPrefix = '[Partenaire]';

  constructor(
    private readonly sponsorService: SponsorService,
    private readonly cmds: MatchCommandsService,
    private readonly state: MatchStateService,
    private readonly prisma: PrismaService,
  ) {}

  /** Active ou désactive la diffusion automatique dans le chat in-game. */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.logger.log(`[SponsorChat] Auto-announcements set to ${enabled ? 'ENABLED' : 'DISABLED'}`);
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  setDefaultPrefix(prefix: string): void {
    this.defaultPrefix = prefix.trim();
  }

  /**
   * Envoie une annonce sponsor ciblée sur un serveur donné.
   * Ne perturbe pas le jeu : respecte le formatage sobre et clair.
   */
  async announceOnServer(serverId: string, options?: AnnounceSponsorOptions): Promise<boolean> {
    const tournamentId = await this.resolveTournamentIdForServer(serverId);

    let sponsor: Sponsor | null = null;
    if (options?.sponsorId) {
      sponsor = await this.sponsorService.findById(options.sponsorId).catch(() => null);
    } else {
      sponsor = await this.sponsorService.selectWeightedSponsor(tournamentId);
    }

    if (!sponsor) {
      this.logger.debug(`[SponsorChat] No active sponsor available for server ${serverId}`);
      return false;
    }

    const prefix = options?.prefix ?? this.defaultPrefix;
    let messageText = options?.customMessage;

    if (!messageText) {
      if (sponsor.messages && sponsor.messages.length > 0) {
        // Tirage aléatoire parmi les messages configurés pour ce sponsor
        const idx = Math.floor(Math.random() * sponsor.messages.length);
        messageText = sponsor.messages[idx];
      } else {
        // Message sobre par défaut
        messageText = `Merci a ${sponsor.name} pour son soutien !`;
      }
    }

    const formatted = `${prefix} ${messageText}`;
    try {
      await this.cmds.say(serverId, formatted);
      this.logger.log(`[SponsorChat] Broadcast sent to ${serverId}: "${formatted}"`);
      return true;
    } catch (err) {
      this.logger.error(`[SponsorChat] Failed to send announcement to ${serverId}: ${String(err)}`);
      return false;
    }
  }

  /**
   * Déclenché lors du début d'une pause tactique ou technique.
   * Diffuse un sponsor pendant le temps mort sans perturber le gameplay.
   */
  onPauseStarted(matchId: string, serverId: string, reason: string): void {
    if (!this.enabled) return;

    this.logger.log(`[SponsorChat] Pause detected on ${serverId} (reason: ${reason}, match: ${matchId}). Scheduling sponsor message...`);
    // Délai court de 2s pour laisser passer la notification de pause
    setTimeout(() => {
      void (async () => {
        try {
          const currentPhase = await this.state.getPhase(matchId);
          // Vérifier que le match est toujours en pause
          if (
            currentPhase === MatchPhase.PAUSED_TAC ||
            currentPhase === MatchPhase.PAUSED_TECH ||
            currentPhase === ('paused_tac' as unknown as MatchPhase) ||
            currentPhase === ('paused_tech' as unknown as MatchPhase)
          ) {
            await this.announceOnServer(serverId);
          }
        } catch (e) {
          this.logger.warn(`[SponsorChat] Error in pause sponsor tick for ${serverId}: ${String(e)}`);
        }
      })();
    }, 2000);
  }

  /**
   * Déclenché lors de la mi-temps.
   */
  onHalfTime(matchId: string, serverId: string): void {
    if (!this.enabled) return;

    this.logger.log(`[SponsorChat] Half-time on ${serverId} (match: ${matchId}). Dispatching sponsor announcement...`);
    setTimeout(() => {
      void (async () => {
        try {
          await this.announceOnServer(serverId);
        } catch (e) {
          this.logger.warn(`[SponsorChat] Error in half-time sponsor dispatch: ${String(e)}`);
        }
      })();
    }, 1500);
  }

  /**
   * Diffuse une annonce sponsor sur tous les serveurs actuellement en pause ou en échauffement (hors-jeu).
   */
  async broadcastToAllNonPlayingServers(prefix?: string): Promise<{ sent: number; servers: string[] }> {
    const servers = await this.prisma.server.findMany({
      where: { status: { not: 'OFFLINE' } },
    });

    const deliveredServers: string[] = [];
    for (const server of servers) {
      const matchId = await this.state.getMatchIdFromServerId(server.name);
      let isNonPlaying = false;

      if (!matchId) {
        // Serveur sans match compétitif actif (idle / warmup)
        isNonPlaying = true;
      } else {
        const phase = await this.state.getPhase(matchId);
        if (
          !phase ||
          phase === MatchPhase.WARMUP_MAIN ||
          phase === MatchPhase.KNIFE_WARMUP ||
          phase === MatchPhase.PAUSED_TAC ||
          phase === MatchPhase.PAUSED_TECH ||
          phase === MatchPhase.HALFTIME ||
          phase === MatchPhase.POSTGAME
        ) {
          isNonPlaying = true;
        }
      }

      if (isNonPlaying) {
        const ok = await this.announceOnServer(server.name, { prefix });
        if (ok) deliveredServers.push(server.name);
      }
    }

    return { sent: deliveredServers.length, servers: deliveredServers };
  }

  /**
   * Résout l'ID du tournoi associé à un serveur en consultant la base de données.
   */
  private async resolveTournamentIdForServer(serverId: string): Promise<string | null> {
    try {
      const matchId = await this.state.getMatchIdFromServerId(serverId);
      const isUuid = typeof matchId === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(matchId);

      if (isUuid && matchId) {
        const matchMap = await this.prisma.matchMap.findUnique({
          where: { id: matchId },
          include: { match: true },
        });
        if (matchMap?.match?.tournamentId) return matchMap.match.tournamentId;
      }

      // Fallback: chercher par serveur actif
      const matchMapByServer = await this.prisma.matchMap.findFirst({
        where: {
          server: { name: serverId },
          status: { in: ['WARMUP', 'LIVE', 'PAUSED'] },
        },
        include: { match: true },
      });

      return matchMapByServer?.match?.tournamentId ?? null;
    } catch {
      return null;
    }
  }
}
