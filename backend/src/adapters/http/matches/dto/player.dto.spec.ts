import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { MovePlayerDto, PLAYER_ID_MAX_LENGTH, PLAYER_NAME_MAX_LENGTH, UpsertPlayerDto } from './player.dto';

async function rulesBroken(Dto: new () => object, body: unknown): Promise<string[]> {
  const errors = await validate(plainToInstance(Dto, body));
  return errors.map((e) => e.property).sort();
}

describe('UpsertPlayerDto', () => {
  it('accepts a player with or without a name, on either team', async () => {
    expect(await rulesBroken(UpsertPlayerDto, { steamId: '[U:1:10000004]', logical: 'home' })).toEqual([]);
    expect(await rulesBroken(UpsertPlayerDto, { steamId: '[U:1:10000004]', name: 'Garitos', logical: 'away' })).toEqual([]);
  });

  it.each([
    ['no Steam id', { logical: 'home' }, ['steamId']],
    ['an empty Steam id', { steamId: '', logical: 'home' }, ['steamId']],
    ['a team that does not exist', { steamId: 'a', logical: 'CT' }, ['logical']],
    ['no team', { steamId: 'a' }, ['logical']],
    ['a name that is not text', { steamId: 'a', logical: 'home', name: 12 }, ['name']],
    ['a name that is null (leaving it out is how to say nothing)', { steamId: 'a', logical: 'home', name: null }, ['name']],
    ['a name of spaces only', { steamId: 'a', logical: 'home', name: '   ' }, ['name']],
    ['an empty name', { steamId: 'a', logical: 'home', name: '' }, ['name']],
    ['a name longer than the guard', { steamId: 'a', logical: 'home', name: 'x'.repeat(PLAYER_NAME_MAX_LENGTH + 1) }, ['name']],
    ['a Steam id longer than the guard', { steamId: 'x'.repeat(PLAYER_ID_MAX_LENGTH + 1), logical: 'home' }, ['steamId']],
    ['a Steam id that is not text', { steamId: 7, logical: 'home' }, ['steamId']],
  ])('refuses %s', async (_label, body, broken) => {
    expect(await rulesBroken(UpsertPlayerDto, body)).toEqual(broken);
  });

  it('accepts the longest name and the longest id the guards allow, and a name with spaces inside', async () => {
    const body = { steamId: 'x'.repeat(PLAYER_ID_MAX_LENGTH), name: 'x'.repeat(PLAYER_NAME_MAX_LENGTH), logical: 'home' };
    expect(await rulesBroken(UpsertPlayerDto, body)).toEqual([]);
    expect(await rulesBroken(UpsertPlayerDto, { steamId: 'a', name: 'Team Alpha Player 1', logical: 'home' })).toEqual([]);
  });
});

describe('MovePlayerDto', () => {
  it('accepts home and away only', async () => {
    expect(await rulesBroken(MovePlayerDto, { logical: 'home' })).toEqual([]);
    expect(await rulesBroken(MovePlayerDto, { logical: 'away' })).toEqual([]);
    expect(await rulesBroken(MovePlayerDto, { logical: 'T' })).toEqual(['logical']);
    expect(await rulesBroken(MovePlayerDto, {})).toEqual(['logical']);
  });
});
