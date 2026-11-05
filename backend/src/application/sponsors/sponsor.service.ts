// src/application/sponsors/sponsor.service.ts
import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '@adapters/database/prisma.service';
import { RealtimeEmitter } from '@adapters/ws/ws-emitter.internal';
import {
  CreateSponsorDto,
  UpdateSponsorDto,
  SponsorFilterDto,
  SponsorTier,
  DEFAULT_TIER_WEIGHTS,
  SponsorRotatePayload,
} from './sponsor.types';
import type { Sponsor, Prisma } from '@prisma/client';

@Injectable()
export class SponsorService {
  private readonly logger = new Logger(SponsorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly emitter: RealtimeEmitter,
  ) {}

  /**
   * Crée un nouveau sponsor (global à la LAN si tournamentId est null/undefined, ou spécifique à un tournoi).
   */
  async create(dto: CreateSponsorDto): Promise<Sponsor> {
    if (!dto.name || !dto.name.trim()) {
      throw new BadRequestException('Le nom du sponsor est requis');
    }

    const tier = dto.tier ?? SponsorTier.STANDARD;
    const weight = dto.weight !== undefined && dto.weight > 0 ? dto.weight : DEFAULT_TIER_WEIGHTS[tier];

    // Vérifier l'existence du tournoi si spécifié
    if (dto.tournamentId) {
      const tournament = await this.prisma.tournament.findUnique({
        where: { id: dto.tournamentId },
      });
      if (!tournament) {
        throw new NotFoundException(`Tournoi ${dto.tournamentId} introuvable`);
      }
    }

    const sponsor = await this.prisma.sponsor.create({
      data: {
        name: dto.name.trim(),
        description: dto.description?.trim() || null,
        logoUrl: dto.logoUrl?.trim() || null,
        websiteUrl: dto.websiteUrl?.trim() || null,
        tier,
        weight,
        active: dto.active ?? true,
        messages: dto.messages ?? [],
        tournamentId: dto.tournamentId || null,
      },
    });

    this.logger.log(`[Sponsor] Created sponsor "${sponsor.name}" (id: ${sponsor.id}, tier: ${sponsor.tier}, weight: ${sponsor.weight})`);
    return sponsor;
  }

  /**
   * Liste les sponsors filtrés.
   * Si tournamentId est renseigné, inclut les sponsors spécifiques à ce tournoi ET les sponsors globaux (LAN).
   */
  async findAll(filter?: SponsorFilterDto): Promise<Sponsor[]> {
    const where: Prisma.SponsorWhereInput = {};

    if (filter?.activeOnly) {
      where.active = true;
    }

    if (filter?.tier) {
      where.tier = filter.tier;
    }

    if (filter?.tournamentId !== undefined) {
      if (filter.tournamentId === null || filter.tournamentId === '') {
        // Uniquement les sponsors globaux
        where.tournamentId = null;
      } else {
        // Sponsors du tournoi + sponsors globaux
        where.OR = [
          { tournamentId: filter.tournamentId },
          { tournamentId: null },
        ];
      }
    }

    return this.prisma.sponsor.findMany({
      where,
      orderBy: [{ weight: 'desc' }, { createdAt: 'asc' }],
    });
  }

  /**
   * Trouve un sponsor par son ID.
   */
  async findById(id: string): Promise<Sponsor> {
    const sponsor = await this.prisma.sponsor.findUnique({
      where: { id },
    });
    if (!sponsor) {
      throw new NotFoundException(`Sponsor ${id} introuvable`);
    }
    return sponsor;
  }

  /**
   * Met à jour un sponsor.
   */
  async update(id: string, dto: UpdateSponsorDto): Promise<Sponsor> {
    await this.findById(id);

    const data: Prisma.SponsorUpdateInput = {};

    if (dto.name !== undefined) {
      if (!dto.name.trim()) throw new BadRequestException('Le nom du sponsor ne peut pas être vide');
      data.name = dto.name.trim();
    }
    if (dto.description !== undefined) {
      data.description = dto.description.trim() || null;
    }
    if (dto.logoUrl !== undefined) {
      data.logoUrl = dto.logoUrl.trim() || null;
    }
    if (dto.websiteUrl !== undefined) {
      data.websiteUrl = dto.websiteUrl.trim() || null;
    }
    if (dto.tier !== undefined) {
      data.tier = dto.tier;
      if (dto.weight === undefined) {
        data.weight = DEFAULT_TIER_WEIGHTS[dto.tier];
      }
    }
    if (dto.weight !== undefined) {
      if (dto.weight <= 0) throw new BadRequestException('Le poids doit être un entier positif');
      data.weight = dto.weight;
    }
    if (dto.active !== undefined) {
      data.active = dto.active;
    }
    if (dto.messages !== undefined) {
      data.messages = dto.messages.map((m) => m.trim()).filter(Boolean);
    }
    if (dto.tournamentId !== undefined) {
      if (dto.tournamentId) {
        const tournament = await this.prisma.tournament.findUnique({
          where: { id: dto.tournamentId },
        });
        if (!tournament) throw new NotFoundException(`Tournoi ${dto.tournamentId} introuvable`);
        data.tournament = { connect: { id: dto.tournamentId } };
      } else {
        data.tournament = { disconnect: true };
      }
    }

    const updated = await this.prisma.sponsor.update({
      where: { id },
      data,
    });

    this.logger.log(`[Sponsor] Updated sponsor "${updated.name}" (${updated.id})`);
    return updated;
  }

  /**
   * Supprime un sponsor.
   */
  async delete(id: string): Promise<void> {
    await this.findById(id);
    await this.prisma.sponsor.delete({ where: { id } });
    this.logger.log(`[Sponsor] Deleted sponsor ${id}`);
  }

  /**
   * Définit l'URL du logo du sponsor (après upload).
   */
  async setLogoUrl(id: string, logoUrl: string): Promise<Sponsor> {
    return this.update(id, { logoUrl });
  }

  /**
   * Ajoute une phrase d'accroche / message au sponsor.
   */
  async addMessage(id: string, message: string): Promise<Sponsor> {
    const trimmed = message.trim();
    if (!trimmed) throw new BadRequestException('Le message ne peut pas être vide');

    const sponsor = await this.findById(id);
    const updatedMessages = [...sponsor.messages, trimmed];

    return this.prisma.sponsor.update({
      where: { id },
      data: { messages: updatedMessages },
    });
  }

  /**
   * Retire un message par son index.
   */
  async removeMessage(id: string, messageIndex: number): Promise<Sponsor> {
    const sponsor = await this.findById(id);
    if (messageIndex < 0 || messageIndex >= sponsor.messages.length) {
      throw new BadRequestException(`Index de message invalide (${messageIndex})`);
    }

    const updatedMessages = sponsor.messages.filter((_, idx) => idx !== messageIndex);
    return this.prisma.sponsor.update({
      where: { id },
      data: { messages: updatedMessages },
    });
  }

  /**
   * Sélectionne un sponsor actif selon le système de poids / tiers.
   * Les sponsors de rang supérieur (ex: PRIMARY = 3) sont tirés plus fréquemment que STANDARD (1).
   * Si un tournamentId est passé, inclut les sponsors du tournoi et les sponsors globaux (LAN).
   */
  async selectWeightedSponsor(tournamentId?: string | null): Promise<Sponsor | null> {
    const sponsors = await this.findAll({
      activeOnly: true,
      tournamentId,
    });

    if (sponsors.length === 0) {
      return null;
    }

    const totalWeight = sponsors.reduce((sum, s) => sum + (s.weight > 0 ? s.weight : DEFAULT_TIER_WEIGHTS[s.tier]), 0);
    if (totalWeight <= 0) {
      return sponsors[0];
    }

    let randomThreshold = Math.random() * totalWeight;
    for (const sponsor of sponsors) {
      const weight = sponsor.weight > 0 ? sponsor.weight : DEFAULT_TIER_WEIGHTS[sponsor.tier];
      if (randomThreshold < weight) {
        return sponsor;
      }
      randomThreshold -= weight;
    }

    return sponsors[sponsors.length - 1];
  }

  /**
   * Déclenche la rotation d'un sponsor pour les overlays de stream et pages publiques (WebSocket sponsor:rotate).
   */
  async rotateOverlay(options?: {
    slot?: string;
    tournamentId?: string | null;
    durationMs?: number;
  }): Promise<SponsorRotatePayload | null> {
    const durationMs = options?.durationMs ?? 15000;
    const sponsor = await this.selectWeightedSponsor(options?.tournamentId);

    if (!sponsor) {
      return null;
    }

    const payload: SponsorRotatePayload = {
      sponsorId: sponsor.id,
      name: sponsor.name,
      logoUrl: sponsor.logoUrl,
      websiteUrl: sponsor.websiteUrl,
      tier: sponsor.tier,
      slot: options?.slot ?? 'main',
      durationMs,
    };

    this.emitter.emitBroadcast('sponsor:rotate', payload);
    this.logger.debug(`[Sponsor] Rotated overlay sponsor to "${sponsor.name}" (slot: ${payload.slot}, duration: ${durationMs}ms)`);
    return payload;
  }
}
