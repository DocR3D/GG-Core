/**
 * Tests unitaires — TournamentMatchCreateController
 *
 * TC-MC-01 : Création d'un match — happy path (changelevel envoyé)
 * TC-MC-02 : changelevel échoue → match quand même créé (fire-and-forget)
 * TC-MC-03 : ctTeamId invalide → 400
 * TC-MC-04 : homeId === awayId → 400
 * TC-MC-05 : maps.length > bo → 400
 * TC-MC-06 : tournoi introuvable → 404
 * TC-MC-07 : équipe hors tournoi → 400
 */

import { TournamentMatchCreateController } from './match-create.controller';
import { BadRequestException, NotFoundException } from '@nestjs/common';

// ─── Constantes de test ────────────────────────────────────────────────────

const TOURNOI_ID = 1;
const HOME_ID    = 12;
const AWAY_ID    = 34;
const SERVER_ID  = 'srv-a';
const DB_ID      = 7;
const FIRST_MAP  = 'de_mirage';

const VALID_DTO = {
  homeId:   HOME_ID,
  awayId:   AWAY_ID,
  serverId: SERVER_ID,
  bo:       1 as const,
  overtime: true,
  maps:     [{ id: FIRST_MAP, ctTeamId: HOME_ID }],
};

// ─── Factories de mocks ────────────────────────────────────────────────────

function makeMatchState() {
  return {
    setSides:            jest.fn().mockResolvedValue(undefined),
    initScore:           jest.fn().mockResolvedValue(undefined),
    initTimeouts:        jest.fn().mockResolvedValue(undefined),
    setTeams:            jest.fn().mockResolvedValue(undefined),
    setServerIdToMatchId:jest.fn().mockResolvedValue(undefined),
    upsertPlayer:        jest.fn().mockResolvedValue(undefined),
  };
}

function makeRcon(changeLevelImpl?: () => Promise<any>) {
  return {
    changeLevel: jest.fn().mockImplementation(
      changeLevelImpl ?? (() => Promise.resolve('')),
    ),
  };
}

function makeTournamentCache(opts?: { missingTournoi?: boolean; missingTeam?: 'home' | 'away' }) {
  const tournament = opts?.missingTournoi ? null : {
    id: TOURNOI_ID,
    name: 'LAN Spring 2025',
    team_ids: [HOME_ID, AWAY_ID],
  };
  const homeTeam = opts?.missingTeam === 'home' ? null : {
    id: HOME_ID, name: 'Alpha', players: [{ id: 101, name: 'player1', isCaptain: true }],
  };
  const awayTeam = opts?.missingTeam === 'away' ? null : {
    id: AWAY_ID, name: 'Beta',  players: [{ id: 201, name: 'player2', isCaptain: false }],
  };
  return {
    getTournament: jest.fn().mockResolvedValue(tournament),
    getTeam: jest.fn().mockImplementation((id: number) =>
      Promise.resolve(id === HOME_ID ? homeTeam : awayTeam),
    ),
  };
}

function makeMatchRepo() {
  return { insert: jest.fn().mockResolvedValue(DB_ID) };
}

function makeHistoryRepo() {
  return { insert: jest.fn().mockResolvedValue(undefined) };
}

function makeRedis() {
  return { set: jest.fn().mockResolvedValue('OK') };
}

function makeController(overrides?: {
  rcon?:  ReturnType<typeof makeRcon>;
  cache?: ReturnType<typeof makeTournamentCache>;
}) {
  return new TournamentMatchCreateController(
    makeMatchState()     as any,
    overrides?.rcon   ?? makeRcon(),
    overrides?.cache  ?? makeTournamentCache(),
    makeMatchRepo()      as any,
    makeHistoryRepo()    as any,
    makeRedis()          as any,
  );
}

// ─── TC-MC-01 : happy path ─────────────────────────────────────────────────

describe('TC-MC-01 — happy path', () => {
  it('retourne ok=true avec matchId et dbId', async () => {
    const ctrl = makeController();
    const result = await ctrl.create(TOURNOI_ID, VALID_DTO);

    expect(result.ok).toBe(true);
    expect(typeof result.matchId).toBe('string');
    expect(result.matchId).toMatch(/^m-/);
    expect(result.dbId).toBe(DB_ID);
  });

  it('envoie changelevel avec le bon serverId et la première map', async () => {
    const rcon = makeRcon();
    const ctrl = makeController({ rcon });

    await ctrl.create(TOURNOI_ID, VALID_DTO);

    expect(rcon.changeLevel).toHaveBeenCalledTimes(1);
    expect(rcon.changeLevel).toHaveBeenCalledWith(SERVER_ID, FIRST_MAP);
  });

  it('initialise les sides CT/T depuis le ctTeamId de la première map (home=CT)', async () => {
    const state = makeMatchState();
    const ctrl = new TournamentMatchCreateController(
      state as any,
      makeRcon(),
      makeTournamentCache() as any,
      makeMatchRepo() as any,
      makeHistoryRepo() as any,
      makeRedis() as any,
    );

    await ctrl.create(TOURNOI_ID, { ...VALID_DTO, maps: [{ id: FIRST_MAP, ctTeamId: HOME_ID }] });

    expect(state.setSides).toHaveBeenCalledWith(
      expect.any(String),
      { home: 'CT', away: 'T' },
    );
  });

  it('initialise les sides T/CT si ctTeamId = awayId (home=T)', async () => {
    const state = makeMatchState();
    const ctrl = new TournamentMatchCreateController(
      state as any,
      makeRcon(),
      makeTournamentCache() as any,
      makeMatchRepo() as any,
      makeHistoryRepo() as any,
      makeRedis() as any,
    );

    await ctrl.create(TOURNOI_ID, { ...VALID_DTO, maps: [{ id: FIRST_MAP, ctTeamId: AWAY_ID }] });

    expect(state.setSides).toHaveBeenCalledWith(
      expect.any(String),
      { home: 'T', away: 'CT' },
    );
  });
});

// ─── TC-MC-02 : changelevel échoue → match quand même créé ────────────────

describe('TC-MC-02 — changelevel échoue (RCON indisponible)', () => {
  it('retourne ok=true même si changeLevel throw', async () => {
    const rcon = makeRcon(() => Promise.reject(new Error('RCON connect timeout')));
    const ctrl = makeController({ rcon });

    const result = await ctrl.create(TOURNOI_ID, VALID_DTO);

    expect(result.ok).toBe(true);
    expect(result.dbId).toBe(DB_ID);
    expect(rcon.changeLevel).toHaveBeenCalledTimes(1);
  });
});

// ─── TC-MC-03 : ctTeamId invalide → 400 ──────────────────────────────────

describe('TC-MC-03 — ctTeamId invalide', () => {
  it('lève BadRequestException si ctTeamId n\'est ni homeId ni awayId', async () => {
    const ctrl = makeController();
    const dto = { ...VALID_DTO, maps: [{ id: FIRST_MAP, ctTeamId: 999 }] };

    await expect(ctrl.create(TOURNOI_ID, dto)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('message d\'erreur mentionne le ctTeamId invalide', async () => {
    const ctrl = makeController();
    const dto = { ...VALID_DTO, maps: [{ id: 'de_nuke', ctTeamId: 999 }] };

    const err = await ctrl.create(TOURNOI_ID, dto).catch((e) => e);
    expect(err.message).toContain('999');
    expect(err.message).toContain('de_nuke');
  });
});

// ─── TC-MC-04 : homeId === awayId → 400 ──────────────────────────────────

describe('TC-MC-04 — homeId === awayId', () => {
  it('lève BadRequestException', async () => {
    const ctrl = makeController();
    const dto = { ...VALID_DTO, homeId: HOME_ID, awayId: HOME_ID };

    await expect(ctrl.create(TOURNOI_ID, dto)).rejects.toBeInstanceOf(BadRequestException);
  });
});

// ─── TC-MC-05 : maps.length > bo → 400 ───────────────────────────────────

describe('TC-MC-05 — maps.length > bo', () => {
  it('lève BadRequestException si 2 maps pour bo=1', async () => {
    const ctrl = makeController();
    const dto = {
      ...VALID_DTO,
      bo: 1 as const,
      maps: [
        { id: 'de_mirage', ctTeamId: HOME_ID },
        { id: 'de_nuke',   ctTeamId: AWAY_ID },
      ],
    };

    await expect(ctrl.create(TOURNOI_ID, dto)).rejects.toBeInstanceOf(BadRequestException);
  });
});

// ─── TC-MC-06 : tournoi introuvable → 404 ────────────────────────────────

describe('TC-MC-06 — tournoi introuvable', () => {
  it('lève NotFoundException si le tournoi n\'est pas dans le cache', async () => {
    const ctrl = makeController({ cache: makeTournamentCache({ missingTournoi: true }) });

    await expect(ctrl.create(TOURNOI_ID, VALID_DTO)).rejects.toBeInstanceOf(NotFoundException);
  });
});

// ─── TC-MC-07 : équipe hors tournoi → 400 ────────────────────────────────

describe('TC-MC-07 — équipe hors tournoi', () => {
  it('lève BadRequestException si homeId absent de team_ids', async () => {
    const cache = makeTournamentCache();
    // Override : tournoi sans HOME_ID dans team_ids
    (cache.getTournament as jest.Mock).mockResolvedValue({
      id: TOURNOI_ID,
      name: 'LAN',
      team_ids: [AWAY_ID], // homeId manquant
    });
    const ctrl = makeController({ cache });

    await expect(ctrl.create(TOURNOI_ID, VALID_DTO)).rejects.toBeInstanceOf(BadRequestException);
  });
});
