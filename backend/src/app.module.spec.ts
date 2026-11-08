/**
 * Boot test: the real module graph (every provider, every injection) must resolve.
 *
 * Unit tests build each service by hand with `new Service(mock, mock)`, so they cannot see a missing provider, a
 * circular dependency or a module that does not export what another one injects: Nest only finds these when it builds
 * the graph, i.e. when the backend starts. This test builds it, with Redis replaced by a stub (nothing connects).
 */
import { Test } from '@nestjs/testing';
import { AppModule } from './app.module';
import { REDIS_CMD, REDIS_PUB, REDIS_SUB } from '@adapters/redis/redis.tokens';
import { PauseMatchService } from '@app/match/pause/pause.service';
import { RoundRestoreService } from '@app/match/restore/round-restore.service';
import { MatchPhaseService } from '@app/match/phase/match-phase.service';

/** A Redis stand-in: every method exists, resolves to undefined, and nothing is ever opened. */
function redisStub(): unknown {
  const noop = () => Promise.resolve(undefined);
  return new Proxy(
    {},
    {
      get: (_t, prop) => (prop === 'then' ? undefined : prop === 'duplicate' ? () => redisStub() : noop),
    },
  );
}

describe('AppModule (real dependency graph)', () => {
  it('resolves every provider without a missing or circular dependency', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(REDIS_CMD).useValue(redisStub())
      .overrideProvider(REDIS_PUB).useValue(redisStub())
      .overrideProvider(REDIS_SUB).useValue(redisStub())
      .compile();

    // The pause service and the restore service depend on each other (forwardRef): both must come out built.
    expect(moduleRef.get(PauseMatchService)).toBeInstanceOf(PauseMatchService);
    expect(moduleRef.get(RoundRestoreService)).toBeInstanceOf(RoundRestoreService);
    expect(moduleRef.get(MatchPhaseService)).toBeInstanceOf(MatchPhaseService);

    await moduleRef.close();
  });
});
