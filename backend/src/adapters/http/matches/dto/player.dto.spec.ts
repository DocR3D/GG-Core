import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { MovePlayerDto, UpsertPlayerDto } from './player.dto';

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
  ])('refuses %s', async (_label, body, broken) => {
    expect(await rulesBroken(UpsertPlayerDto, body)).toEqual(broken);
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
