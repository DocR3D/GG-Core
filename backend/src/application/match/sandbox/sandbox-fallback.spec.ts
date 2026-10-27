import { cleanContainerLogPrefix, parseCs2LineFallback } from './sandbox.service';
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
  });

  describe('DatabaseEventsHandler — Suicide vs Player Kill distinction', () => {
    let handler: DatabaseEventsHandler;
    let mockPersistence: any;

    beforeEach(() => {
      mockPersistence = {
        recordEventLog: jest.fn().mockResolvedValue(undefined),
        resolvePlayer: jest.fn().mockResolvedValue({ id: 'p-uuid-1' }),
        recordPlayerKill: jest.fn().mockResolvedValue(undefined),
        recordRoundResult: jest.fn().mockResolvedValue(undefined),
      };
      handler = new DatabaseEventsHandler(mockPersistence);
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
        'm-1',
        EventTypes.KILL,
        suicideEvent.payload,
        expect.any(Number),
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
          matchMapId: 'm-1',
          playerId: 'p-uuid-1',
          teamId: 'CT',
          isHeadshot: true,
        }),
      );
    });
  });
});
