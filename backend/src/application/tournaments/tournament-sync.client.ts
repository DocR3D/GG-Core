// src/application/tournaments/tournament-sync.client.ts
import { Injectable, Logger } from '@nestjs/common';
import type { ApiResponse } from './tournament.types';

const API_URL = 'https://testapi.gglan.fr/api/tournaments';
const FETCH_TIMEOUT_MS = 10_000;

@Injectable()
export class TournamentSyncClient {
  private readonly log = new Logger(TournamentSyncClient.name);

  async fetchAll(): Promise<ApiResponse> {
    this.log.debug(`GET ${API_URL}`);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    let res: Response;
    try {
      res = await fetch(API_URL, {
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
    } catch (err) {
      throw new Error(`Impossible de joindre l'API externe: ${(err as Error).message}`);
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      throw new Error(`API externe HTTP ${res.status} ${res.statusText}`);
    }

    const body = await res.json() as ApiResponse;

    if (body.status !== 'success') {
      throw new Error(`API externe: status="${body.status}" message="${body.message}"`);
    }

    this.log.debug(`API retourne ${body.data?.length ?? 0} tournoi(s)`);
    return body;
  }
}
