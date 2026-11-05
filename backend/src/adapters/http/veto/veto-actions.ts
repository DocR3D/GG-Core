import { BadRequestException, ConflictException, ForbiddenException, HttpException, Injectable, NotFoundException } from '@nestjs/common';
import type { Session } from '@app/auth/auth.service';
import { TournamentError } from '@app/tournament/tournament-stages.service';
import { VetoActor, VetoService } from '@app/tournament/veto.service';
import { RealtimeEmitter } from '@adapters/ws/ws-emitter.internal';
import type { VetoUpdatedWsEvent } from '@adapters/ws/dto/events.dto';

export type VetoBody =
  | { _form?: string; _page?: string; choice?: string; first?: boolean | string; teamId?: string; map?: string; side?: string }
  | undefined;

export function actorOf(session: Session | null | undefined): VetoActor | undefined {
  if (!session) return undefined;
  return { steamId: session.via === 'steam' ? session.sub : undefined, admin: session.role === 'admin', name: session.name };
}

export function vetoFirst(value: boolean | string | undefined): boolean | undefined {
  return value === undefined ? undefined : value === true || value === 'true';
}

/** Shared mutation path for the HTML forms and JSON veto routes. */
@Injectable()
export class VetoActions {
  constructor(
    private readonly veto: VetoService,
    private readonly realtime: RealtimeEmitter,
  ) {}

  async execute(id: string, session: Session | null | undefined, action: (actor: VetoActor) => Promise<unknown>) {
    const actor = actorOf(session);
    if (!actor) throw new HttpException({ statusCode: 401, message: 'authentication required (Sign in through Steam on /login)' }, 401);
    await this.mapError(() => action(actor));
    await this.broadcast(id);
    return this.mapError(() => this.veto.getState(id, actor));
  }

  private async broadcast(matchId: string) {
    try {
      const state = await this.veto.getState(matchId);
      const event: VetoUpdatedWsEvent = {
        type: 'veto:updated',
        matchId: state.matchId,
        seq: state.seq,
        ts: Date.now(),
        payload: state,
      };
      this.realtime.emitPublic(state.matchId, 'veto:updated', event);
    } catch {
      // The mutation is durable; clients can still refresh if the best-effort push fails.
    }
  }

  private async mapError<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (!(e instanceof TournamentError)) throw e;
      if (e.code === 'not_found') throw new NotFoundException(e.message);
      if (e.code === 'conflict') throw new ConflictException(e.message);
      if (e.code === 'forbidden') throw new ForbiddenException(e.message);
      throw new BadRequestException(e.message);
    }
  }
}
