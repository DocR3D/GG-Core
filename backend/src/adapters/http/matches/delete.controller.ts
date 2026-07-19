// src/adapters/http/matches/delete.controller.ts
import {
  Controller, Delete, Param, Inject, Logger, NotFoundException, ParseIntPipe,
} from '@nestjs/common';
import {
  ApiTags, ApiOperation, ApiParam, ApiOkResponse, ApiNotFoundResponse,
} from '@nestjs/swagger';
import type Redis from 'ioredis';
import { REDIS_CMD } from '@adapters/redis/redis.tokens';
import { MatchRepository } from '@adapters/postgres/match.repository';
import { redisConst } from '@app/match/state/redis.keys';

@ApiTags('matches')
@Controller('matches')
export class MatchDeleteController {
  private readonly logger = new Logger(MatchDeleteController.name);

  constructor(
    private readonly matchRepo: MatchRepository,
    @Inject(REDIS_CMD) private readonly redis: Redis,
  ) {}

  @Delete(':id')
  @ApiOperation({
    summary: 'Supprimer un match',
    description: `Supprime définitivement un match : toutes les clés Redis \`match:{redisId}:*\`,
la liaison serveur \`server:{serverId}:currentMatch\`, et la ligne PostgreSQL
(la MatchHistory cascade automatiquement via \`ON DELETE CASCADE\`).`,
  })
  @ApiParam({ name: 'id', description: 'ID PostgreSQL du match', example: 1 })
  @ApiOkResponse({
    schema: {
      example: { ok: true, deletedRedisKeys: 18, serverFreed: 'srv-a' },
    },
  })
  @ApiNotFoundResponse({ description: 'Match introuvable' })
  async deleteMatch(@Param('id', ParseIntPipe) id: number) {
    const match = await this.matchRepo.findById(id);
    if (!match) throw new NotFoundException(`Match ${id} introuvable`);

    const redisId = match.match_redis_id;

    // 1. Récupérer le serveur lié avant de supprimer les clés
    const serverId = await this.redis.get(redisConst.matchServer(redisId));

    // 2. Supprimer toutes les clés Redis du match
    const keys = await this.redis.keys(`match:${redisId}:*`);
    if (keys.length > 0) {
      await this.redis.del(...keys);
    }

    // 3. Libérer le serveur
    if (serverId) {
      await this.redis.del(redisConst.serverMatch(serverId));
    }

    // 4. Supprimer en PostgreSQL (cascade sur MatchHistory)
    await this.matchRepo.delete(id);

    this.logger.log(
      `Match supprimé : db_id=${id} redis_id=${redisId} redis_keys=${keys.length} server=${serverId ?? 'none'}`,
    );

    return { ok: true, deletedRedisKeys: keys.length, serverFreed: serverId ?? null };
  }
}
