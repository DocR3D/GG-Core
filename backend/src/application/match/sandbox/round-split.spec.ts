import * as fs from 'fs';
import * as path from 'path';
import { splitRawLogIntoRounds, splitScenarioIntoRounds } from './sandbox.service';
import { EventTypes } from '@domain/events/event.types';

/**
 * Round-by-round replay cuts a match into one slice per round. The slicing must be lossless (replaying all
 * slices in order == replaying the whole file) and its boundaries must match CS2's own round ends.
 */
const fixturesDir = path.resolve(__dirname, '../../../../../test/fixtures');
const readLines = (id: string) =>
  fs.readFileSync(path.join(fixturesDir, 'raw-logs', id), 'utf8').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

const rawFixtures = fs.readdirSync(path.join(fixturesDir, 'raw-logs')).filter((f) => f.endsWith('.log'));
const scenarios = fs.readdirSync(path.join(fixturesDir, 'scenarios')).filter((f) => f.endsWith('.json'));

describe('splitRawLogIntoRounds - real CS2 logs', () => {
  it.each(rawFixtures)('%s: lossless, one slice per round, each slice after the first starts at Round_Start', (id) => {
    const lines = readLines(id);
    const chunks = splitRawLogIntoRounds(lines);

    expect(chunks.flatMap((c) => c.items)).toEqual(lines);
    chunks.slice(1).forEach((c) => expect(c.items[0]).toContain('World triggered "Round_Start"'));
    // every slice but possibly the last (unfinished round at end of file) carries a round end
    chunks.slice(0, -1).forEach((c) => expect(c.end).not.toBeNull());
  });

  it.each(rawFixtures.filter((id) => readLines(id).some((l) => l.includes('Game Over:'))))(
    '%s: the last round end is the Game Over score',
    (id) => {
      const lines = readLines(id);
      const [, ct, t] = lines.find((l) => l.includes('Game Over:'))!.match(/score (\d+):(\d+)/)!;
      const ends = splitRawLogIntoRounds(lines).map((c) => c.end).filter(Boolean);
      expect(ends[ends.length - 1]).toMatchObject({ ct: Number(ct), t: Number(t) });
    },
  );

  it('a backup restore is its own step, labelled with the restored score (Round_Draw)', () => {
    const draws = (id: string) =>
      splitRawLogIntoRounds(readLines(id))
        .filter((c) => c.end?.outcome === 'Round_Draw' && c.end.ct + c.end.t > 0)
        .map((c) => `${c.end!.ct}-${c.end!.t}`);

    // In both matches the two restores happen during the same pause, with no Round_Start in between:
    // one step, carrying the final restored score.
    expect(draws('gglan19_match69_nuke_backup_restore_anonymized.log')).toEqual(['5-1']);
    expect(draws('gglan19_match85_inferno_double_restore_anonymized.log')).toEqual(['0-6']);
  });
});

describe('splitScenarioIntoRounds - JSON scenarios', () => {
  it.each(scenarios)('%s: lossless and one slice per round end', (id) => {
    const parsed = JSON.parse(fs.readFileSync(path.join(fixturesDir, 'scenarios', id), 'utf8'));
    const events: any[] = Array.isArray(parsed) ? parsed : parsed.events;
    const chunks = splitScenarioIntoRounds(events);

    expect(chunks.flatMap((c) => c.items)).toEqual(events);
    const roundEnds = events.filter((e) => e.type === EventTypes.TEAM_ROUND_WIN || e.type === EventTypes.SFUI_TARGET_BOMBED);
    expect(chunks.filter((c) => c.end).length).toBeLessThanOrEqual(roundEnds.length);
    expect(chunks.filter((c) => c.end).length).toBeGreaterThan(0);
  });
});
