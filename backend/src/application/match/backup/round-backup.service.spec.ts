// src/application/match/backup/round-backup.service.spec.ts
import { RoundBackupService } from './round-backup.service';
import * as fs from 'fs';
import * as path from 'path';

describe('RoundBackupService', () => {
  let service: RoundBackupService;

  beforeEach(() => {
    service = new RoundBackupService();
  });

  it('devrait être défini', () => {
    expect(service).toBeDefined();
  });

  describe('parseValveBackup avec le fichier réel sample_round_backup_anonymized.txt', () => {
    it('devrait parser correctement un backup réel anonymisé CS2', () => {
      const fixturePath = path.resolve(__dirname, '../../../../../test/fixtures/backups/sample_round_backup_anonymized.txt');
      expect(fs.existsSync(fixturePath)).toBe(true);

      const content = fs.readFileSync(fixturePath, 'utf8');
      const parsed = service.parseValveBackup(content);

      expect(parsed.round).toBe(1);
      expect(parsed.team1).toBe('Team Alpha');
      expect(parsed.team2).toBe('Team Bravo');
      expect(parsed.map).toBe('de_anubis');
      expect(parsed.timestamp).toBe('2026-10-24 11:54:34');
      expect(parsed.roundResults[1]).toBe(1);
      expect(parsed.playersTeam1.length).toBeGreaterThan(0);

      const p1 = parsed.playersTeam1.find((p) => p.steamId === '10000001');
      expect(p1).toBeDefined();
      expect(p1?.name).toBe('Player_01');
      expect(p1?.cash).toBe(3950);
      expect(p1?.kills).toBe(1);
      expect(p1?.roundsWon).toBe(1);

      const p10 = parsed.playersTeam2.find((p) => p.steamId === '10000010');
      expect(p10).toBeDefined();
      expect(p10?.name).toBe('Player_10');
      expect(p10?.cash).toBe(2050);
    });

    it('devrait parser correctement un backup réel en Overtime 5 (Round 53) gglan19_match156_ot5_round53_anonymized.txt', () => {
      const fixturePath = path.resolve(__dirname, '../../../../../test/fixtures/backups/gglan19_match156_ot5_round53_anonymized.txt');
      expect(fs.existsSync(fixturePath)).toBe(true);

      const content = fs.readFileSync(fixturePath, 'utf8');
      const parsed = service.parseValveBackup(content);

      expect(parsed.round).toBe(53);
      expect(parsed.team1).toBe('Team Alpha');
      expect(parsed.team2).toBe('Team Bravo');
      expect(parsed.map).toBe('de_inferno');
      expect(parsed.firstHalfScore.team1).toBe(7);
      expect(parsed.firstHalfScore.team2).toBe(5);
      expect(parsed.secondHalfScore.team1).toBe(5);
      expect(parsed.secondHalfScore.team2).toBe(7);
      expect(parsed.overtimeScore.team1).toBe(13);
      expect(parsed.overtimeScore.team2).toBe(16);
      expect(parsed.overtimeScore.overtimeId).toBe(5);
      expect(Object.keys(parsed.roundResults).length).toBeGreaterThanOrEqual(30);
    });
  });

  describe('generateValveBackup & Round-trip', () => {
    it('devrait générer un backup VDF valide pour une mi-temps (6-5)', () => {
      const vdf = service.generateValveBackup({
        round: 11,
        team1Name: 'Navi',
        team2Name: 'FaZe',
        map: 'de_mirage',
        scoreTeam1: 6,
        scoreTeam2: 5,
        playersTeam1: [
          { steamId: '76561198000000042', name: 's1mple', cash: 16000, kills: 14, roundsWon: 6 },
        ],
        playersTeam2: [
          { steamId: '76561198000000099', name: 'karrigan', cash: 3200, kills: 5, roundsWon: 5 },
        ],
      });

      expect(vdf).toContain('"SaveFile"');
      expect(vdf).toContain('"team1"\t\t"Navi"');
      expect(vdf).toContain('"team2"\t\t"FaZe"');
      expect(vdf).toContain('"round"\t\t"11"');
      expect(vdf).toContain('"FirstHalfScore"');
      expect(vdf).toContain(`"${service.toValveAccountId('76561198000000042')}"`);
      expect(vdf).toContain('"cash"\t\t"16000"');

      // Re-parser pour vérifier l'intégrité round-trip
      const reParsed = service.parseValveBackup(vdf);
      expect(reParsed.round).toBe(11);
      expect(reParsed.team1).toBe('Navi');
      expect(reParsed.team2).toBe('FaZe');
      expect(reParsed.firstHalfScore.team1).toBe(6);
      expect(reParsed.firstHalfScore.team2).toBe(5);
      expect(reParsed.playersTeam1[0].name).toBe('s1mple');
      expect(reParsed.playersTeam1[0].cash).toBe(16000);
      expect(reParsed.playersTeam2[0].name).toBe('karrigan');
      expect(reParsed.playersTeam2[0].cash).toBe(3200);
    });

    it('devrait générer un backup VDF avec OvertimeScore lors des prolongations', () => {
      const vdf = service.generateValveBackup({
        round: 27,
        team1Name: 'Team Vitality',
        team2Name: 'Heroic',
        map: 'de_nuke',
        scoreTeam1: 14,
        scoreTeam2: 13,
        firstHalfScore: { team1: 7, team2: 5 },
        secondHalfScore: { team1: 5, team2: 7 },
        overtimeScore: { team1: 2, team2: 1, overtimeId: 1 },
      });

      expect(vdf).toContain('"OvertimeScore"');
      expect(vdf).toContain('"OvertimeID"\t\t"1"');

      const reParsed = service.parseValveBackup(vdf);
      expect(reParsed.round).toBe(27);
      expect(reParsed.firstHalfScore).toEqual({ team1: 7, team2: 5 });
      expect(reParsed.secondHalfScore).toEqual({ team1: 5, team2: 7 });
      expect(reParsed.overtimeScore).toEqual({ team1: 2, team2: 1, overtimeId: 1 });
    });
  });
});
