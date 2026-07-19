// src/application/tournaments/tournament-sync.service.ts
//
// Orchestrateur : appel API → mapping → mise en cache.
// Implémente OnModuleInit pour initialiser le cache au démarrage.

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { TournamentSyncClient } from './tournament-sync.client';
import { TournamentCacheService } from './tournament-cache.service';
import { TournamentRepository } from '@adapters/postgres/tournament.repository';
import { mapApiResponse } from './tournament.mapper';

@Injectable()
export class TournamentSyncService implements OnModuleInit {
  private readonly log = new Logger(TournamentSyncService.name);

  constructor(
    private readonly client: TournamentSyncClient,
    private readonly cache: TournamentCacheService,
    private readonly tournamentRepo: TournamentRepository,
  ) {}

  // Appelé automatiquement par NestJS au démarrage du module
  async onModuleInit() {
    this.log.log('Initialisation du cache tournois au démarrage…');
    await this.sync();
  }

  // -----------------------------------------------------------------------
  // Sync manuel (appelable par un endpoint admin ou un cron futur)
  // -----------------------------------------------------------------------

  async sync(): Promise<{ ok: boolean; tournaments: number; teams: number; error?: string }> {
    try {
      const response = await this.client.fetchAll();
      const result   = mapApiResponse(response.data ?? []);
      await this.cache.store(result);
      await this.tournamentRepo.upsertAll(result);

      this.log.log(`Sync OK — ${result.tournaments.length} tournoi(s), ${result.teams.length} équipe(s)`);
      return { ok: true, tournaments: result.tournaments.length, teams: result.teams.length };
    } catch (err) {
      const error = (err as Error).message;
      this.log.error(`Sync FAILED: ${error}`);
      return { ok: false, tournaments: 0, teams: 0, error };
    }
  }
}
