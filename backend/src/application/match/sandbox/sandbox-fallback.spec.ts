import { cleanContainerLogPrefix, parseCs2LineFallback } from '@app/parser/cs2-log-parser.fallback';
import { DatabaseEventsHandler } from '../../subscribers/database-events.handler';
import { EventTypes } from '@domain/events/event.types';

describe('Fallback Parser & Suicide vs Player Kill Handling', () => {
  describe('cleanContainerLogPrefix', () => {
    it('strips Pterodactyl / Docker container timestamps', () => {
      const containerLine = '10/25 11:00:36 [Server] L 10/25/2025 - 11:00:36: "Console<0>" say "Match live"';
      const cleaned = cleanContainerLogPrefix(containerLine);
      expect(cleaned).toBe('L 10/25/2025 - 11:00:36: "Console<0>" say "Match live"');
    });

    it('leaves native lines intact', () => {
      const nativeLine = 'L 10/24/2026 - 19:20:00: World triggered "Round_Start"';
      expect(cleanContainerLogPrefix(nativeLine)).toBe(nativeLine);
    });
  });

  describe('parseCs2LineFallback (Anti-Phantom Map Kills)', () => {
    it('parses World Match_Start as match_start and NEVER as a kill', () => {
      const line = 'L 10/24/2026 - 19:50:17: World triggered "Match_Start" on "de_inferno"';
      const event = parseCs2LineFallback(line, 'm-1', 'srv-a');

      expect(event).not.toBeNull();
      expect(event.type).toBe('match_start');
      expect(event.type).not.toBe('kill');
    });

    it.each([
      ['L 10/30/2026 - 08:53:17: Game Over: competitive mg_active de_inferno score 5:7 after 29 min', 'de_inferno', 5, 7],
      ['L 10/26/2025 - 13:12:19: Game Over: competitive  de_mirage score 11:13 after 36 min', 'de_mirage', 11, 13],
    ])('parses Game Over like the Go parser (score CT:T, map group optional): %s', (line, map, ct, t) => {
      const ev = parseCs2LineFallback(line, 'm1', 'srv-a');
      expect(ev).toEqual(expect.objectContaining({
        type: 'game_over',
        payload: expect.objectContaining({ map, scoreCT: ct, scoreT: t }),
      }));
    });

    it('parses World Round_Draw (backup restore) like the Go parser: winner none, reason draw, restored score', () => {
      const line = 'L 10/25/2025 - 11:01:49: World triggered "SFUI_Notice_Round_Draw" (CT "5") (T "1")';
      const event = parseCs2LineFallback(line, 'm-1', 'srv-a');

      expect(event).toMatchObject({
        type: 'team_round_win',
        payload: { winner: 'none', reason: 'draw', score: { ct: 5, t: 1 } },
      });
    });

    it('counts a bomb death once: killed by the bomb is the death, its world-suicide twin is skipped', () => {
      const bomb = parseCs2LineFallback('"Player_03<6><[U:1:10000003]><TERRORIST>" [1256 -1309 8] was killed by the bomb.', 'm-bomb', 'srv-a');
      const twin = parseCs2LineFallback('"Player_03<6><[U:1:10000003]><TERRORIST>" [1256 -1309 8] committed suicide with "world"', 'm-bomb', 'srv-a');

      expect(bomb).toMatchObject({ type: 'kill', payload: { kind: 'suicide', weapon: 'bomb' } });
      expect(twin).toBeNull();
    });

    it('counts the world suicide that follows a disconnect as a death', () => {
      parseCs2LineFallback('"Player_04<7><[U:1:10000004]><CT>" disconnected (reason "NETWORK_DISCONNECT_DISCONNECT_BY_USER")', 'm-disc', 'srv-a');
      const suicide = parseCs2LineFallback('"Player_04<7><[U:1:10000004]><CT>" [2397 2079 133] committed suicide with "world"', 'm-disc', 'srv-a');

      expect(suicide).toMatchObject({ type: 'kill', payload: { kind: 'suicide', weapon: 'world' } });
    });

    it('ignores World Match_Reloaded on map without creating phantom kills', () => {
      const line = 'World triggered "Match_Reloaded" on "de_inferno"';
      const event = parseCs2LineFallback(line, 'm-1', 'srv-a');

      expect(event).toBeNull();
    });

    it('parses genuine player kills accurately', () => {
      const line = '"Alpha_Kilo<0><[U:1:1002]><CT>" [-1507 -341 105] killed "Bravo_Alfa<15><[U:1:2002]><TERRORIST>" [-470 -58 86] with "m4a1" (headshot)';
      const event = parseCs2LineFallback(line, 'm-1', 'srv-a');

      expect(event).not.toBeNull();
      expect(event.type).toBe('kill');
      expect(event.payload.kind).toBe('player');
      expect(event.payload.killer.name).toBe('Alpha_Kilo');
      expect(event.payload.victim.name).toBe('Bravo_Alfa');
      expect(event.payload.weapon).toBe('m4a1');
      expect(event.payload.headshot).toBe(true);
    });

    it('parses team round win events with defuse reason', () => {
      const line = 'Team "CT" triggered "SFUI_Notice_Bomb_Defused" (CT "4") (T "5")';
      const event = parseCs2LineFallback(line, 'm-1', 'srv-a');

      expect(event).not.toBeNull();
      expect(event.type).toBe('team_round_win');
      expect(event.payload.winner).toBe('CT');
      expect(event.payload.reason).toBe('defused');
    });

    it('distinguishes Bomb_Begin_Plant from Planted_The_Bomb', () => {
      const beginLine = '"Player_03<5><[U:1:10000003]><TERRORIST>" triggered "Bomb_Begin_Plant" at bombsite B';
      const beginEv = parseCs2LineFallback(beginLine, 'm-1', 'srv-a');
      expect(beginEv).not.toBeNull();
      expect(beginEv.type).toBe('begin_bomb_plant');

      const plantedLine = '"Hydra_Three<8><[U:1:20000003]><TERRORIST>" triggered "Planted_The_Bomb" at [150 -100 80]';
      const plantedEv = parseCs2LineFallback(plantedLine, 'm-1', 'srv-a');
      expect(plantedEv).not.toBeNull();
      expect(plantedEv.type).toBe('bomb_planted');
      expect(plantedEv.payload.planter.name).toBe('Hydra_Three');
    });

    it('parses Defused_The_Bomb and Begin_Bomb_Defuse', () => {
      const defusedLine = '"Phoenix_Three<3><[U:1:10000003]><CT>" triggered "Defused_The_Bomb"';
      const defusedEv = parseCs2LineFallback(defusedLine, 'm-1', 'srv-a');
      expect(defusedEv).not.toBeNull();
      expect(defusedEv.type).toBe('bomb_defused');
      expect(defusedEv.payload.defuser.name).toBe('Phoenix_Three');

      const beginDefuseLine = '"Player_06<9><[U:1:10000006]><CT>" triggered "Begin_Bomb_Defuse_With_Kit"';
      const beginDefuseEv = parseCs2LineFallback(beginDefuseLine, 'm-1', 'srv-a');
      expect(beginDefuseEv).not.toBeNull();
      expect(beginDefuseEv.type).toBe('defuse_begin');
      expect(beginDefuseEv.payload.hasKit).toBe(true);
    });

    it('parses suicide and assist lines', () => {
      const suicideLine = '"Player_01<2><[U:1:10000001]><TERRORIST>" [-959 -789 117] committed suicide with "world"';
      const suicideEv = parseCs2LineFallback(suicideLine, 'm-1', 'srv-a');
      expect(suicideEv).not.toBeNull();
      expect(suicideEv.type).toBe('kill');
      expect(suicideEv.payload.kind).toBe('suicide');
      expect(suicideEv.payload.player.name).toBe('Player_01');

      const assistLine = '"Player_06<9><[U:1:10000006]><CT>" flash-assisted killing "Player_01<2><[U:1:10000001]><TERRORIST>"';
      const assistEv = parseCs2LineFallback(assistLine, 'm-1', 'srv-a');
      expect(assistEv).not.toBeNull();
      expect(assistEv.type).toBe('assist');
      expect(assistEv.payload.flashAssist).toBe(true);
    });
  });

  describe('DatabaseEventsHandler - Suicide vs Player Kill distinction', () => {
    const MAP_UUID = '11111111-1111-4111-8111-111111111111';
    const HOME_UUID = '22222222-2222-4222-8222-222222222222';
    let handler: DatabaseEventsHandler;
    let mockPersistence: any;
    let mockState: any;

    beforeEach(() => {
      mockPersistence = {
        recordEventLog: jest.fn().mockResolvedValue(undefined),
        resolvePlayer: jest.fn().mockResolvedValue({ id: 'p-uuid-1' }),
        recordPlayerKill: jest.fn().mockResolvedValue(undefined),
        recordRoundResult: jest.fn().mockResolvedValue(undefined),
        findMatchMap: jest.fn().mockResolvedValue({ id: MAP_UUID, matchId: 'match-uuid', match: { format: 'BO1' } }),
      };
      // Match "m-1" rattaché au MatchMap MAP_UUID, home = CT = HOME_UUID
      mockState = {
        getDbMatchMapId: jest.fn().mockResolvedValue(MAP_UUID),
        sideToLogical: jest.fn().mockResolvedValue('home'),
        getTeamIds: jest.fn().mockResolvedValue({ home_id: HOME_UUID, away_id: null }),
      };
      handler = new DatabaseEventsHandler(mockPersistence, mockState);
    });

    it('does NOT award a player kill when kind is suicide (e.g. death by world)', async () => {
      const suicideEvent = {
        v: 1,
        id: 'ev-suicide-1',
        type: EventTypes.KILL,
        matchId: 'm-1',
        payload: {
          kind: 'suicide',
          player: { name: 'Player_03', steamId: '[U:1:10000003]', team: 'CT' },
          weapon: 'world',
        },
      } as any;

      await handler.handle(suicideEvent);

      // L'événement est consigné dans l'Event Sourcing historique
      expect(mockPersistence.recordEventLog).toHaveBeenCalledWith(
        MAP_UUID,
        EventTypes.KILL,
        suicideEvent.payload,
        expect.any(Number),
        expect.objectContaining({ matchId: 'm-1' }),
      );

      // Mais il n'incrémente AUCUN frag dans les stats de joueurs
      expect(mockPersistence.recordPlayerKill).not.toHaveBeenCalled();
      expect(mockPersistence.resolvePlayer).not.toHaveBeenCalled();
    });

    it('records player kill stats when kind is player', async () => {
      const playerKillEvent = {
        v: 1,
        id: 'ev-kill-1',
        type: EventTypes.KILL,
        matchId: 'm-1',
        payload: {
          kind: 'player',
          killer: { name: 'Alpha_Kilo', steamId: '[U:1:1002]', team: 'CT' },
          victim: { name: 'Bravo_Alfa', steamId: '[U:1:2002]', team: 'TERRORIST' },
          weapon: 'm4a1',
          headshot: true,
        },
      } as any;

      await handler.handle(playerKillEvent);

      expect(mockPersistence.recordEventLog).toHaveBeenCalled();
      expect(mockPersistence.resolvePlayer).toHaveBeenCalledWith({
        steamId: '[U:1:1002]',
        username: 'Alpha_Kilo',
      });
      expect(mockPersistence.recordPlayerKill).toHaveBeenCalledWith(
        expect.objectContaining({
          matchMapId: MAP_UUID,
          playerId: 'p-uuid-1',
          teamId: HOME_UUID,
          isHeadshot: true,
        }),
      );
    });
  });
});
