// src/application/community-messages/community-messages.service.ts
import { Injectable, Logger, NotFoundException, BadRequestException, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '@adapters/database/prisma.service';
import {
  CreateCommunityMessageDto,
  UpdateCommunityMessageDto,
  CommunityMessageFilterDto,
  DEFAULT_COMMUNITY_MESSAGES,
} from './community-messages.types';
import type { CommunityMessage, Prisma } from '@prisma/client';

@Injectable()
export class CommunityMessagesService implements OnModuleInit {
  private readonly logger = new Logger(CommunityMessagesService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    await this.seedDefaults().catch((err) => {
      this.logger.warn(`[CommunityMessages] Erreur auto-seed des messages: ${String(err)}`);
    });
  }

  /**
   * Initialise les 3 messages historiques GG-Lan si la table est vide.
   */
  async seedDefaults(): Promise<number> {
    const count = await this.prisma.communityMessage.count();
    if (count > 0) return 0;

    let inserted = 0;
    for (const text of DEFAULT_COMMUNITY_MESSAGES) {
      await this.prisma.communityMessage.create({
        data: {
          text,
          category: 'fun_fact',
          active: true,
          tournamentId: null,
        },
      });
      inserted++;
    }
    this.logger.log(`[CommunityMessages] ${inserted} messages historiques GG-Lan initialisés avec succès`);
    return inserted;
  }

  /**
   * Crée un nouveau message d'information ou fun fact.
   */
  async create(dto: CreateCommunityMessageDto): Promise<CommunityMessage> {
    const trimmed = dto.text?.trim();
    if (!trimmed) {
      throw new BadRequestException('Le texte du message est requis');
    }

    if (dto.tournamentId) {
      const tournament = await this.prisma.tournament.findUnique({
        where: { id: dto.tournamentId },
      });
      if (!tournament) {
        throw new NotFoundException(`Tournoi ${dto.tournamentId} introuvable`);
      }
    }

    const created = await this.prisma.communityMessage.create({
      data: {
        text: trimmed,
        category: dto.category?.trim() || 'info',
        active: dto.active ?? true,
        tournamentId: dto.tournamentId || null,
      },
    });

    this.logger.log(`[CommunityMessages] Message créé: "${created.text}" (id: ${created.id})`);
    return created;
  }

  /**
   * Liste les messages selon les filtres.
   */
  async findAll(filter?: CommunityMessageFilterDto): Promise<CommunityMessage[]> {
    const where: Prisma.CommunityMessageWhereInput = {};

    if (filter?.activeOnly) {
      where.active = true;
    }

    if (filter?.category) {
      where.category = filter.category;
    }

    if (filter?.tournamentId !== undefined) {
      if (filter.tournamentId === null || filter.tournamentId === '') {
        where.tournamentId = null;
      } else {
        where.OR = [{ tournamentId: filter.tournamentId }, { tournamentId: null }];
      }
    }

    return this.prisma.communityMessage.findMany({
      where,
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * Trouve un message par son ID.
   */
  async findById(id: string): Promise<CommunityMessage> {
    const message = await this.prisma.communityMessage.findUnique({
      where: { id },
    });
    if (!message) {
      throw new NotFoundException(`Message communautaire ${id} introuvable`);
    }
    return message;
  }

  /**
   * Met à jour un message.
   */
  async update(id: string, dto: UpdateCommunityMessageDto): Promise<CommunityMessage> {
    await this.findById(id);

    const data: Prisma.CommunityMessageUpdateInput = {};

    if (dto.text !== undefined) {
      const trimmed = dto.text.trim();
      if (!trimmed) throw new BadRequestException('Le texte ne peut pas être vide');
      data.text = trimmed;
    }

    if (dto.category !== undefined) {
      data.category = dto.category.trim() || 'info';
    }

    if (dto.active !== undefined) {
      data.active = dto.active;
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

    const updated = await this.prisma.communityMessage.update({
      where: { id },
      data,
    });

    this.logger.log(`[CommunityMessages] Message mis à jour (${updated.id})`);
    return updated;
  }

  /**
   * Supprime un message.
   */
  async delete(id: string): Promise<void> {
    await this.findById(id);
    await this.prisma.communityMessage.delete({ where: { id } });
    this.logger.log(`[CommunityMessages] Message supprimé (${id})`);
  }

  /**
   * Retourne la liste des phrases actives à diffuser pendant le warmup.
   * Si la base ne contient aucun message actif, bascule automatiquement sur les messages historiques par défaut.
   */
  async getActiveWarmupMessages(tournamentId?: string | null): Promise<string[]> {
    try {
      const messages = await this.findAll({
        activeOnly: true,
        tournamentId,
      });

      if (messages.length > 0) {
        return messages.map((m) => m.text);
      }
    } catch (err) {
      this.logger.warn(`[CommunityMessages] Erreur lecture messages warmup, fallback par défaut: ${String(err)}`);
    }

    return [...DEFAULT_COMMUNITY_MESSAGES];
  }
}
