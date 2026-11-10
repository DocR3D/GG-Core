/**
 * MatchStateService is the single door to the state of a match: it holds no state, it hands each call to the service
 * that owns it (sides and score, timeouts, teams and roster, economy, player stats, snapshot). What it does itself is
 * small and worth pinning: the defaults of the initial state, the "TERRORIST" -> "T" normalisation before a side is
 * used, and the two-step snapshot and restore of a round.
 */
import { MatchStateService } from './match-state.service';

const M = 'm-1';

type Mocks = Record<'sidesScore' | 'timeouts' | 'teamsRoster' | 'economy' | 'playerStats' | 'snapshotQ', Record<string, jest.Mock>>;

/** Every method of a collaborator answers a marker of its own, so a call that goes to the wrong one shows. */
function collaborator(name: string): Record<string, jest.Mock> {
  return new Proxy({} as Record<string, jest.Mock>, {
    get(target, method: string) {
      target[method] ??= jest.fn().mockReturnValue(`${name}.${method}`);
      return target[method];
    },
  });
}

function setup() {
  const mocks: Mocks = {
    sidesScore: collaborator('sidesScore'),
    timeouts: collaborator('timeouts'),
    teamsRoster: collaborator('teamsRoster'),
    economy: collaborator('economy'),
    playerStats: collaborator('playerStats'),
    snapshotQ: collaborator('snapshotQ'),
  };
  const svc = new MatchStateService(
    mocks.sidesScore as never,
    mocks.timeouts as never,
    mocks.teamsRoster as never,
    mocks.economy as never,
    mocks.playerStats as never,
    mocks.snapshotQ as never,
  );
  return { svc, ...mocks };
}

describe('MatchStateService : initial state', () => {
  it('starts a match with home CT / away T, a score at zero and four tactical pauses each, nothing else', async () => {
    const { svc, sidesScore, timeouts, teamsRoster } = setup();

    await svc.initMatchState(M);

    expect(sidesScore.setSides).toHaveBeenCalledWith(M, { home: 'CT', away: 'T' });
    expect(sidesScore.initScore).toHaveBeenCalledWith(M);
    expect(timeouts.initTimeouts).toHaveBeenCalledWith(M, 4, 4, 0, 0, {});
    expect(teamsRoster.setTeams).not.toHaveBeenCalled();
    expect(sidesScore.setSettings).not.toHaveBeenCalled();
    expect(sidesScore.setServerMatch).not.toHaveBeenCalled();
    expect(sidesScore.setDbMatchMapId).not.toHaveBeenCalled();
  });

  it('takes the sides, the pauses, the teams, the settings and the links given', async () => {
    const { svc, sidesScore, timeouts, teamsRoster } = setup();
    const teams = { home_id: 'h', away_id: 'a', home_name: 'Démo Rouge', away_name: 'Démo Bleue' };

    await svc.initMatchState(M, {
      home: 'T',
      away: 'CT',
      homeTac: 2,
      awayTac: 3,
      homeTech: 1,
      awayTech: 5,
      teams,
      settings: { warmupMoney: 800 } as never,
      serverId: 'srv-a',
      matchMapId: 'mm-1',
    });

    expect(sidesScore.setSides).toHaveBeenCalledWith(M, { home: 'T', away: 'CT' });
    expect(timeouts.initTimeouts).toHaveBeenCalledWith(M, 2, 3, 1, 5, {});
    expect(teamsRoster.setTeams).toHaveBeenCalledWith(M, teams);
    expect(sidesScore.setSettings).toHaveBeenCalledWith(M, { warmupMoney: 800 });
    expect(sidesScore.setServerMatch).toHaveBeenCalledWith('srv-a', M, undefined);
    expect(sidesScore.setDbMatchMapId).toHaveBeenCalledWith(M, 'mm-1');
  });

  it('sets the sides before anything else, so the score and the teams find them', async () => {
    const { svc, sidesScore } = setup();
    const order: string[] = [];
    sidesScore.setSides.mockImplementation(() => void order.push('sides'));
    sidesScore.initScore.mockImplementation(() => void order.push('score'));

    await svc.initMatchState(M);

    expect(order).toEqual(['sides', 'score']);
  });
});

describe('MatchStateService : sides written the CS2 way', () => {
  it('turns "TERRORIST" into "T" before asking which team a side is, scoring a point or ending a round', async () => {
    const { svc, sidesScore, economy } = setup();

    await svc.sideToLogical(M, 'TERRORIST');
    await svc.addPoint(M, 'TERRORIST');
    await svc.updateEconomyOnRoundEnd(M, 'TERRORIST');
    await svc.roundEnd(M, 'TERRORIST', [{ steamId: 'a', money: 800, equip: 0 }]);

    expect(sidesScore.sideToLogical).toHaveBeenCalledWith(M, 'T');
    expect(sidesScore.addPoint).toHaveBeenCalledWith(M, 'T');
    expect(economy.updateEconomyOnRoundEnd).toHaveBeenCalledWith(M, 'T');
    expect(economy.roundEnd).toHaveBeenCalledWith(M, 'T', [{ steamId: 'a', money: 800, equip: 0 }]);
  });

  it('leaves "CT" and "T" as they are', async () => {
    const { svc, sidesScore } = setup();

    await svc.addPoint(M, 'CT');
    await svc.addPoint(M, 'T');

    expect(sidesScore.addPoint.mock.calls).toEqual([[M, 'CT'], [M, 'T']]);
  });
});

describe('MatchStateService : a round, photographed then restored', () => {
  it('photographs the player stats and the team economy of the round', async () => {
    const { svc, playerStats, economy } = setup();

    await svc.snapshotRound(M, 12);

    expect(playerStats.snapshotPlayerStats).toHaveBeenCalledWith(M, 12);
    expect(economy.snapshotTeamEconomy).toHaveBeenCalledWith(M, 12);
    expect(economy.snapshotPlayersEconomy).toHaveBeenCalledWith(M, 12);
  });

  it('restores both, and says so', async () => {
    const { svc, playerStats, economy } = setup();
    playerStats.restorePlayerStats.mockResolvedValue(true);

    expect(await svc.restoreRound(M, 12)).toBe(true);

    expect(playerStats.restorePlayerStats).toHaveBeenCalledWith(M, 12);
    expect(economy.restoreTeamEconomy).toHaveBeenCalledWith(M, 12);
  });

  it('touches nothing of the economy, and says false, when there is no photo of the round', async () => {
    const { svc, playerStats, economy } = setup();
    playerStats.restorePlayerStats.mockResolvedValue(false);

    expect(await svc.restoreRound(M, 12)).toBe(false);

    expect(economy.restoreTeamEconomy).not.toHaveBeenCalled();
  });
});

// The rest is hand-over: each call goes to the service that owns it, with the same arguments, and what comes back is
// what that service answered.
describe('MatchStateService : hand-over to the owner of each state', () => {
  type Owner = keyof Mocks;
  const cases: Array<[method: keyof MatchStateService, args: unknown[], owner: Owner, target: string, targetArgs?: unknown[]]> = [
    ['setServerIdToMatchId', ['srv', M, 60], 'sidesScore', 'setServerMatch'],
    ['getMatchIdFromServerId', ['srv'], 'sidesScore', 'getMatchIdFromServerId'],
    ['getServerIdFromMatchId', [M], 'sidesScore', 'getServerIdFromMatchId'],
    ['unbindServer', ['srv'], 'sidesScore', 'unbindServer'],
    ['getAgentState', ['srv'], 'sidesScore', 'getAgentState'],
    ['setDbMatchMapId', [M, 'mm'], 'sidesScore', 'setDbMatchMapId'],
    ['getDbMatchMapId', [M], 'sidesScore', 'getDbMatchMapId'],
    ['setSides', [M, { home: 'CT', away: 'T' }], 'sidesScore', 'setSides'],
    ['getSides', [M], 'sidesScore', 'getSides'],
    ['swapSides', [M], 'sidesScore', 'swapSides'],
    ['logicalToSide', [M, 'home'], 'sidesScore', 'logicalToSide'],
    ['applyKnifeResult', [M, 'CT'], 'sidesScore', 'applyKnifeResult'],
    ['getKnifeResult', [M], 'sidesScore', 'getKnifeWinner'],
    ['initScore', [M], 'sidesScore', 'initScore'],
    ['setPhase', [M, 'live_main'], 'sidesScore', 'setPhase'],
    ['incRound', [M], 'sidesScore', 'incRound'],
    ['reconcileScore', [M, 8, 4], 'sidesScore', 'reconcileScore'],
    ['getPhase', [M], 'sidesScore', 'getPhase'],
    ['getRound', [M], 'sidesScore', 'getRound'],
    ['getScore', [M], 'sidesScore', 'getScore'],
    ['getLastScoredRound', [M], 'sidesScore', 'getLastScoredRound'],
    ['setLastScoredRound', [M, 7], 'sidesScore', 'setLastScoredRound'],
    ['isHalftimePlayed', [M], 'sidesScore', 'isHalftimePlayed'],
    ['setHalftimePlayed', [M, true], 'sidesScore', 'setHalftimePlayed'],
    ['getOvertimeCount', [M], 'sidesScore', 'getOvertimeCount'],
    ['setOvertimeCount', [M, 2], 'sidesScore', 'setOvertimeCount'],
    ['getReview', [M], 'sidesScore', 'getReview'],
    ['setReview', [M, null], 'sidesScore', 'setReview'],
    ['getSettings', [M], 'sidesScore', 'getSettings'],
    ['setSettings', [M, {}], 'sidesScore', 'setSettings'],
    ['decrTac', [M, 'home'], 'timeouts', 'decrTac'],
    ['decrTech', [M, 'away'], 'timeouts', 'decrTech'],
    ['getTimeouts', [M], 'timeouts', 'getTimeouts'],
    ['initTimeouts', [M, 1, 2, 3, 4, { force: true }], 'timeouts', 'initTimeouts'],
    ['setTeams', [M, { home_id: 'h' }], 'teamsRoster', 'setTeams'],
    ['getScoreWithTeams', [M], 'teamsRoster', 'getScoreWithTeams'],
    ['getTeamIds', [M], 'teamsRoster', 'getTeamIds'],
    ['upsertPlayer', [M, { steamId: 'a', logical: 'home' }, { preserveLogical: true }], 'teamsRoster', 'upsertPlayer'],
    ['movePlayerLogical', [M, 'a', 'away'], 'teamsRoster', 'movePlayerLogical'],
    ['removePlayer', [M, 'a'], 'teamsRoster', 'removePlayer'],
    ['clearRoster', [M], 'teamsRoster', 'clearRoster'],
    ['getPlayers', [M], 'teamsRoster', 'getPlayers'],
    ['setPlayerMoney', [M, 'a', 800], 'teamsRoster', 'setPlayerMoney'],
    ['setPlayerEquipValue', [M, 'a', 2000], 'teamsRoster', 'setPlayerEquipValue'],
    ['getPlayersEconomy', [M], 'teamsRoster', 'getPlayersEconomy'],
    ['recordKill', [M, { steamId: 'a' }, { steamId: 'b' }, true, false], 'playerStats', 'recordKill'],
    ['recordAssist', [M, { steamId: 'a' }, true], 'playerStats', 'recordAssist'],
    ['recordBombPlant', [M, { steamId: 'a' }], 'playerStats', 'recordBombPlant'],
    ['recordBombDefuse', [M, { steamId: 'a' }], 'playerStats', 'recordBombDefuse'],
    ['getPlayerStats', [M], 'playerStats', 'getPlayerStats'],
    ['setPlayerStats', [M, 'a', { kills: 3 }], 'playerStats', 'setPlayerStats'],
    ['resetPlayerStats', [M], 'playerStats', 'resetPlayerStats'],
    ['initEconomy', [M], 'economy', 'initEconomy'],
    ['resetStreaks', [M], 'economy', 'resetStreaks'],
    ['getTeamEconomyMeta', [M], 'economy', 'getTeamEconomyMeta'],
    ['setTeamLossStreak', [M, 'home', 2], 'economy', 'setTeamLossStreak'],
    ['getSnapshot', [M], 'snapshotQ', 'getSnapshot'],
    ['getTeamEconomyAt', [M, 12], 'economy', 'getTeamEconomyAt'],
    ['getPlayersEconomyAt', [M, 12], 'economy', 'getPlayersEconomyAt'],
  ];

  it.each(cases)('%s goes to %s.%s with the same arguments', async (method, args, owner, target) => {
    const all = setup();
    const call = all.svc[method] as (...a: unknown[]) => unknown;

    const answer = await call.apply(all.svc, args);

    expect(all[owner][target]).toHaveBeenCalledWith(...args);
    expect(answer).toBe(`${owner}.${target}`);
  });

  it('gives the defaults of the pauses when only the match is given', async () => {
    const { svc, timeouts } = setup();

    await svc.initTimeouts(M);

    expect(timeouts.initTimeouts).toHaveBeenCalledWith(M, 4, 4, 0, 0, {});
  });

  it('records a kill without a victim and without flags as a plain kill', async () => {
    const { svc, playerStats } = setup();

    await svc.recordKill(M, { steamId: 'a' });

    expect(playerStats.recordKill).toHaveBeenCalledWith(M, { steamId: 'a' }, undefined, false, false);
  });

  it('records an assist without a flash by default', async () => {
    const { svc, playerStats } = setup();

    await svc.recordAssist(M, { steamId: 'a' });

    expect(playerStats.recordAssist).toHaveBeenCalledWith(M, { steamId: 'a' }, false);
  });
});
