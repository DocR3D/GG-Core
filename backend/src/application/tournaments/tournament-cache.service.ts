// src/application/tournaments/tournament-cache.service.ts
//
// Stratégie de clés Redis :
//
//   gglan:tournaments:all          → JSON Tournament[]   (index complet)
//   gglan:tournament:{id}          → JSON Tournament     (lookup rapide par id)
//   gglan:team:{id}                → JSON Team           (lookup rapide par id)
//   gglan:sync:last                → ISO timestamp du dernier sync réussi
//
// Pas de TTL : le cache est valide jusqu'au prochain sync.
// Le sync est déclenché au démarrage + manuellement via TournamentSyncService.

import { Injectable, Inject, Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS_CMD } from '@adapters/redis/redis.tokens';
import type { Tournament, Team, SyncResult } from './tournament.types';

const K = {
  tournamentsAll:   () => 'gglan:tournaments:all',
  tournament:  (id: number | string) => `gglan:tournament:${id}`,
  team:        (id: number | string) => `gglan:team:${id}`,
  syncLast:         () => 'gglan:sync:last',
} as const;

@Injectable()
export class TournamentCacheService {
  private readonly log = new Logger(TournamentCacheService.name);

  constructor(@Inject(REDIS_CMD) private readonly redis: Redis) {}

  // -----------------------------------------------------------------------
  // Écriture — appelée par le sync
  // -----------------------------------------------------------------------

  async store(result: SyncResult): Promise<void> {
    const pipe = this.redis.multi();

    // Index complet
    pipe.set(K.tournamentsAll(), JSON.stringify(result.tournaments));

    // Par tournoi
    for (const t of result.tournaments) {
      pipe.set(K.tournament(t.id), JSON.stringify(t));
    }

    // Par équipe
    for (const team of result.teams) {
      pipe.set(K.team(team.id), JSON.stringify(team));
    }

    // Timestamp du dernier sync
    pipe.set(K.syncLast(), new Date().toISOString());

    await pipe.exec();

    this.log.log(
      `Cache mis à jour : ${result.tournaments.length} tournoi(s), ${result.teams.length} équipe(s)`,
    );
  }

  // -----------------------------------------------------------------------
  // Lecture — appelée par le controller
  // -----------------------------------------------------------------------

  async getAllTournaments(): Promise<Tournament[] | null> {
    const raw = await this.redis.get(K.tournamentsAll());
    return raw ? (JSON.parse(raw) as Tournament[]) : null;
  }

  async getTournament(id: number): Promise<Tournament | null> {
    const raw = await this.redis.get(K.tournament(id));
    return raw ? (JSON.parse(raw) as Tournament) : null;
  }

  async getTeam(id: number): Promise<Team | null> {
    const raw = await this.redis.get(K.team(id));
    return raw ? (JSON.parse(raw) as Team) : null;
  }

  async getLastSyncAt(): Promise<string | null> {
    return this.redis.get(K.syncLast());
  }
}
