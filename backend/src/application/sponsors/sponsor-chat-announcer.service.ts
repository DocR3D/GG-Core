// src/application/sponsors/sponsor-chat-announcer.service.ts
import { Injectable, Logger, Inject, OnModuleInit, forwardRef } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { REDIS_CMD } from '@adapters/redis/redis.tokens';
import { SponsorService } from './sponsor.service';
import { MatchCommandsService } from '@app/commands/match-commands.service';
import { MatchStateService } from '@app/match/state/match-state.service';
import { PrismaService } from '@adapters/database/prisma.service';
import { MatchPhase } from '@domain/phase.types';
import {
  SponsorChatConfig,
  UpdateSponsorChatConfigDto,
  DEFAULT_SPONSOR_CHAT_CONFIG,
  AnnounceSponsorOptions,
} from './sponsor.types';
import type { Sponsor } from '@prisma/client';

const REDIS_CONFIG_KEY = 'sponsors:config';

@Injectable()
export class SponsorChatAnnouncerService implements OnModuleInit {
  private readonly logger = new Logger(SponsorChatAnnouncerService.name);
  private config: SponsorChatConfig = { ...DEFAULT_SPONSOR_CHAT_CONFIG };
  // Anti-spam par serveur : timestamp de la dernière annonce diffusée
  private readonly lastAnnouncedAt = new Map<string, number>();

  constructor(
    private readonly sponsorService: SponsorService,
    @Inject(forwardRef(() => MatchCommandsService))
    private readonly cmds: MatchCommandsService,
    private readonly state: MatchStateService,
    private readonly prisma: PrismaService,
    @Inject(REDIS_CMD) private readonly redis: Redis,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.loadConfig();
  }

  /**
   * Charge la configuration depuis Redis ou initialise avec les valeurs par défaut.
   */
  async loadConfig(): Promise<SponsorChatConfig> {
    try {
      const raw = await this.redis.get(REDIS_CONFIG_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<SponsorChatConfig>;
        this.config = { ...DEFAULT_SPONSOR_CHAT_CONFIG, ...parsed };
      }
    } catch (err) {
      this.logger.warn(`[SponsorChat] Impossible de charger la config Redis, utilisation du défaut: ${String(err)}`);
    }
    return this.config;
  }

  /**
   * Retourne la configuration actuelle.
   */
  getConfig(): SponsorChatConfig {
    return { ...this.config };
  }

  /**
   * Met à jour la configuration à la volée (sauvegardée dans Redis).
   */
  async updateConfig(dto: UpdateSponsorChatConfigDto): Promise<SponsorChatConfig> {
    this.config = {
      ...this.config,
      ...dto,
    };
    try {
      await this.redis.set(REDIS_CONFIG_KEY, JSON.stringify(this.config));
    } catch (err) {
      this.logger.warn(`[SponsorChat] Erreur sauvegarde config Redis: ${String(err)}`);
    }
    this.logger.log(
      `[SponsorChat] Config mise à jour: enabled=${this.config.enabled}, pauses=${this.config.enableInPauses} (${this.config.pauseDelaySec}s), warmup=${this.config.enableInWarmup}, cooldown=${this.config.minIntervalBetweenMessagesSec}s`,
    );
    return { ...this.config };
  }

  /**
   * Vérifie le cooldown anti-spam pour un serveur donné.
   */
  private isCooldownActive(serverId: string): boolean {
    const last = this.lastAnnouncedAt.get(serverId);
    if (!last) return false;
    const elapsedSec = (Date.now() - last) / 1000;
    return elapsedSec < this.config.minIntervalBetweenMessagesSec;
  }

  /**
   * Envoie une annonce sponsor ciblée sur un serveur donné.
   * Respecte le cooldown anti-spam configuré (sauf si forcé par ignoreCooldown).
   */
  async announceOnServer(serverId: string, options?: AnnounceSponsorOptions): Promise<boolean> {
    if (!this.config.enabled && !options?.ignoreCooldown) {
      return false;
    }

    if (!options?.ignoreCooldown && this.isCooldownActive(serverId)) {
      this.logger.debug(`[SponsorChat] Cooldown actif sur ${serverId}, annonce ignorée pour éviter de spammer`);
      return false;
    }

    const tournamentId = await this.resolveTournamentIdForServer(serverId);

    let sponsor: Sponsor | null;
    if (options?.sponsorId) {
      sponsor = await this.sponsorService.findById(options.sponsorId).catch(() => null);
    } else {
      sponsor = await this.sponsorService.selectWeightedSponsor(tournamentId);
    }

    if (!sponsor) {
      this.logger.debug(`[SponsorChat] Aucun sponsor actif disponible pour le serveur ${serverId}`);
      return false;
    }

    const prefix = options?.prefix ?? this.config.prefix;
    let messageText = options?.customMessage;

    if (!messageText) {
      if (sponsor.messages && sponsor.messages.length > 0) {
        const idx = Math.floor(Math.random() * sponsor.messages.length);
        messageText = sponsor.messages[idx];
      } else {
        messageText = `Merci a ${sponsor.name} pour son soutien !`;
      }
    }

    const formatted = `${prefix} ${messageText}`;
    try {
      await this.cmds.say(serverId, formatted);
      this.lastAnnouncedAt.set(serverId, Date.now());
      this.logger.log(`[SponsorChat] Annonce diffusée sur ${serverId}: "${formatted}"`);
      return true;
    } catch (err) {
      this.logger.error(`[SponsorChat] Échec envoi vers ${serverId}: ${String(err)}`);
      return false;
    }
  }

  /**
   * Déclenché lors du début d'une pause tactique ou technique.
   * Si désactivé ou si cooldown non écoulé, ne diffuse absolument rien.
   * Si activé, attend le délai configuré (ex: 15s) avant d'envoyer UNE annonce.
   */
  onPauseStarted(matchId: string, serverId: string, reason: string): void {
    if (!this.config.enabled || !this.config.enableInPauses) {
      // Désactivé par configuration : aucune distraction pour les joueurs
      return;
    }

    if (this.isCooldownActive(serverId)) {
      return;
    }

    this.logger.log(
      `[SponsorChat] Pause détectée sur ${serverId} (${reason}). Message sponsor programmé dans ${this.config.pauseDelaySec}s...`,
    );

    const delayMs = Math.max(1, this.config.pauseDelaySec) * 1000;
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
          this.logger.warn(`[SponsorChat] Erreur annonce pause sur ${serverId}: ${String(e)}`);
        }
      })();
    }, delayMs);
  }

  /**
   * Déclenché lors de la mi-temps.
   */
  onHalfTime(matchId: string, serverId: string): void {
    if (!this.config.enabled || !this.config.enableInHalftime) {
      return;
    }

    if (this.isCooldownActive(serverId)) {
      return;
    }

    this.logger.log(`[SponsorChat] Mi-temps sur ${serverId} (match: ${matchId}). Diffusion sponsor...`);
    setTimeout(() => {
      void (async () => {
        try {
          await this.announceOnServer(serverId);
        } catch (e) {
          this.logger.warn(`[SponsorChat] Erreur annonce mi-temps: ${String(e)}`);
        }
      })();
    }, 2000);
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
