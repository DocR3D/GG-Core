// src/application/match/backup/round-backup.service.ts
import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

export interface ValveBackupPlayer {
  steamId: string;
  name: string;
  cash?: number;
  kills?: number;
  assists?: number;
  deaths?: number;
  mvps?: number;
  score?: number;
  roundsWon?: number;
  helmet?: number;
}

export interface ValveBackupOptions {
  round: number;
  team1Name: string;
  team2Name: string;
  map?: string;
  scoreTeam1?: number;
  scoreTeam2?: number;
  firstHalfScore?: { team1: number; team2: number };
  secondHalfScore?: { team1: number; team2: number };
  overtimeScore?: { team1: number; team2: number; overtimeId?: number };
  roundResults?: Record<number, number>;
  playersTeam1?: ValveBackupPlayer[];
  playersTeam2?: ValveBackupPlayer[];
  timestamp?: string;
}

export interface ParsedValveBackup {
  round: number;
  team1: string;
  team2: string;
  map: string;
  timestamp: string;
  firstHalfScore: { team1: number; team2: number };
  secondHalfScore?: { team1: number; team2: number };
  overtimeScore?: { team1: number; team2: number; overtimeId?: number };
  roundResults: Record<number, number>;
  playersTeam1: ValveBackupPlayer[];
  playersTeam2: ValveBackupPlayer[];
  raw?: Record<string, any>;
}

@Injectable()
export class RoundBackupService {
  private readonly logger = new Logger(RoundBackupService.name);

  /**
   * Génère le contenu d'un fichier de backup natif Valve CS2 au format KeyValues VDF (.txt)
   */
  generateValveBackup(opts: ValveBackupOptions): string {
    const round = opts.round ?? 0;
    const team1 = opts.team1Name || 'Team Alpha';
    const team2 = opts.team2Name || 'Team Bravo';
    const map = opts.map || 'de_inferno';
    const timestamp = opts.timestamp || this.formatTimestamp(new Date());

    const totalScore1 = opts.scoreTeam1 ?? 0;
    const totalScore2 = opts.scoreTeam2 ?? 0;

    // Calcul automatique des scores par mi-temps si non fournis
    let fh1 = opts.firstHalfScore?.team1;
    let fh2 = opts.firstHalfScore?.team2;
    let sh1 = opts.secondHalfScore?.team1;
    let sh2 = opts.secondHalfScore?.team2;
    let ot1 = opts.overtimeScore?.team1;
    let ot2 = opts.overtimeScore?.team2;

    if (fh1 === undefined || fh2 === undefined) {
      if (round <= 12) {
        fh1 = totalScore1;
        fh2 = totalScore2;
      } else {
        // En MR12, si score > 12 au total ou round > 12, première mi-temps max 12 rounds
        const firstHalfPlayed = 12;
        const ratio = totalScore1 + totalScore2 > 0 ? totalScore1 / (totalScore1 + totalScore2) : 0.5;
        fh1 = Math.min(12, Math.round(firstHalfPlayed * ratio));
        fh2 = firstHalfPlayed - fh1;
      }
    }

    if (round > 12 && (sh1 === undefined || sh2 === undefined)) {
      if (round <= 24) {
        sh1 = Math.max(0, totalScore1 - fh1);
        sh2 = Math.max(0, totalScore2 - fh2);
      } else {
        const reg1 = Math.min(12, totalScore1);
        const reg2 = Math.min(12, totalScore2);
        sh1 = Math.max(0, reg1 - fh1);
        sh2 = Math.max(0, reg2 - fh2);
      }
    }

    if (round > 24 && (ot1 === undefined || ot2 === undefined)) {
      ot1 = Math.max(0, totalScore1 - (fh1 + (sh1 ?? 0)));
      ot2 = Math.max(0, totalScore2 - (fh2 + (sh2 ?? 0)));
    }

    // Round results (1..30)
    const results: Record<number, number> = { ...(opts.roundResults ?? {}) };
    let assigned1 = 0;
    let assigned2 = 0;

    // Compter ce qui est déjà assigné (1 ou 3/5/6)
    for (let r = 1; r <= round; r++) {
      if (results[r] !== undefined && results[r] !== 0) {
        if (results[r] === 1 || results[r] === 3) assigned1++;
        else if (results[r] === 2 || results[r] === 6 || results[r] === 5) assigned2++;
      }
    }

    // Compléter les rounds joués pour respecter totalScore1 et totalScore2
    for (let r = 1; r <= Math.max(round, 30); r++) {
      if (r <= round) {
        if (results[r] === undefined || results[r] === 0) {
          if (assigned1 < totalScore1) {
            results[r] = 3; // Team 1 round win
            assigned1++;
          } else if (assigned2 < totalScore2) {
            results[r] = 6; // Team 2 round win
            assigned2++;
          } else {
            results[r] = 1;
          }
        }
      } else {
        if (results[r] === undefined) {
          results[r] = 0;
        }
      }
    }

    const lines: string[] = [];
    lines.push('"SaveFile"');
    lines.push('{');
    lines.push(`\t"timestamp"\t\t"${timestamp}"`);
    lines.push(`\t"team1"\t\t"${team1}"`);
    lines.push(`\t"team2"\t\t"${team2}"`);
    lines.push(`\t"map"\t\t"${map}"`);
    lines.push(`\t"round"\t\t"${round}"`);

    // FirstHalfScore
    lines.push('\t"FirstHalfScore"');
    lines.push('\t{');
    lines.push(`\t\t"team1"\t\t"${fh1}"`);
    lines.push(`\t\t"team2"\t\t"${fh2}"`);
    lines.push('\t}');

    // SecondHalfScore
    if (round > 12 || sh1 !== undefined || sh2 !== undefined) {
      lines.push('\t"SecondHalfScore"');
      lines.push('\t{');
      lines.push(`\t\t"team1"\t\t"${sh1 ?? 0}"`);
      lines.push(`\t\t"team2"\t\t"${sh2 ?? 0}"`);
      lines.push('\t}');
    }

    // OvertimeScore
    if (round > 24 || ot1 !== undefined || ot2 !== undefined) {
      lines.push('\t"OvertimeScore"');
      lines.push('\t{');
      lines.push(`\t\t"team1"\t\t"${ot1 ?? 0}"`);
      lines.push(`\t\t"team2"\t\t"${ot2 ?? 0}"`);
      lines.push(`\t\t"OvertimeID"\t\t"${opts.overtimeScore?.overtimeId ?? 1}"`);
      lines.push('\t}');
    }

    // History
    lines.push('\t"History"');
    lines.push('\t{');
    lines.push('\t\t"NumConsecutiveTerroristLoses"\t\t"0"');
    lines.push('\t\t"NumConsecutiveCTLoses"\t\t"0"');
    lines.push('\t\t"LoserMostRecentTeam"\t\t"CT"');
    lines.push('\t\t"SpawnPointsCfg"\t\t"892560323"');
    lines.push('\t}');

    // RoundResults
    lines.push('\t"RoundResults"');
    lines.push('\t{');
    for (let r = 1; r <= 30; r++) {
      lines.push(`\t\t"round${r}"\t\t"${results[r] ?? 0}"`);
    }
    lines.push('\t}');

    // PlayersAliveT
    lines.push('\t"PlayersAliveT"');
    lines.push('\t{');
    for (let r = 1; r <= 30; r++) {
      lines.push(`\t\t"round${r}"\t\t"${r <= round ? 0 : 63}"`);
    }
    lines.push('\t}');

    // PlayersAliveCT
    lines.push('\t"PlayersAliveCT"');
    lines.push('\t{');
    for (let r = 1; r <= 30; r++) {
      lines.push(`\t\t"round${r}"\t\t"${r <= round ? 2 : 63}"`);
    }
    lines.push('\t}');

    // Timeouts
    lines.push('\t"Timeouts"');
    lines.push('\t{');
    lines.push('\t\t"team1"\t\t"4"');
    lines.push('\t\t"team2"\t\t"4"');
    lines.push('\t\t"technical"');
    lines.push('\t\t{');
    lines.push('\t\t\t"team1"\t\t"0"');
    lines.push('\t\t\t"team2"\t\t"0"');
    lines.push('\t\t}');
    lines.push('\t}');

    // PlayersOnTeam1
    lines.push('\t"PlayersOnTeam1"');
    lines.push('\t{');
    const players1 = opts.playersTeam1?.length
      ? opts.playersTeam1
      : [
          { steamId: '76561198000000001', name: 'Tester_T1_A', cash: 16000, roundsWon: totalScore1 },
          { steamId: '76561198000000002', name: 'Tester_T1_B', cash: 16000, roundsWon: totalScore1 },
        ];
    for (const p of players1) {
      this.writePlayerBlock(lines, p, totalScore1);
    }
    lines.push('\t}');

    // PlayersOnTeam2
    lines.push('\t"PlayersOnTeam2"');
    lines.push('\t{');
    const players2 = opts.playersTeam2?.length
      ? opts.playersTeam2
      : [
          { steamId: '76561198000000003', name: 'Tester_T2_A', cash: 16000, roundsWon: totalScore2 },
          { steamId: '76561198000000004', name: 'Tester_T2_B', cash: 16000, roundsWon: totalScore2 },
        ];
    for (const p of players2) {
      this.writePlayerBlock(lines, p, totalScore2);
    }
    lines.push('\t}');

    lines.push('}');
    lines.push('');

    return lines.join('\n');
  }

  private writePlayerBlock(lines: string[], p: ValveBackupPlayer, teamScore: number) {
    const steamId = p.steamId;
    const name = p.name || `Player_${steamId.slice(-4)}`;
    const cash = p.cash ?? 16000;
    const kills = p.kills ?? 0;
    const assists = p.assists ?? 0;
    const deaths = p.deaths ?? 0;
    const score = p.score ?? (kills * 2 + assists);
    const mvps = p.mvps ?? 0;
    const roundsWon = p.roundsWon ?? teamScore;
    const helmet = p.helmet ?? 1;

    lines.push(`\t\t"${steamId}"`);
    lines.push('\t\t{');
    lines.push(`\t\t\t"name"\t\t"${name}"`);
    lines.push(`\t\t\t"kills"\t\t"${kills}"`);
    lines.push(`\t\t\t"assists"\t\t"${assists}"`);
    lines.push(`\t\t\t"deaths"\t\t"${deaths}"`);
    lines.push(`\t\t\t"mvps"\t\t"${mvps}"`);
    lines.push(`\t\t\t"score"\t\t"${score}"`);
    lines.push(`\t\t\t"cash"\t\t"${cash}"`);
    lines.push(`\t\t\t"roundsWon"\t\t"${roundsWon}"`);
    lines.push(`\t\t\t"enemyKs"\t\t"${kills}"`);
    lines.push(`\t\t\t"enemyHSs"\t\t"${Math.floor(kills / 2)}"`);
    lines.push(`\t\t\t"enemy2Ks"\t\t"0"`);
    lines.push(`\t\t\t"enemy3Ks"\t\t"0"`);
    lines.push(`\t\t\t"enemy4Ks"\t\t"0"`);
    lines.push(`\t\t\t"enemy5Ks"\t\t"0"`);
    lines.push(`\t\t\t"enemyKAg"\t\t"${kills}"`);
    lines.push(`\t\t\t"firstKs"\t\t"0"`);
    lines.push(`\t\t\t"clutchKs"\t\t"0"`);
    lines.push(`\t\t\t"kills_weapon_pistol"\t\t"0"`);
    lines.push(`\t\t\t"kills_weapon_sniper"\t\t"0"`);
    lines.push(`\t\t\t"kills_knife"\t\t"0"`);
    lines.push(`\t\t\t"kills_taser"\t\t"0"`);
    lines.push(`\t\t\t"enemyDamageDealt"\t\t"${kills * 100}"`);
    lines.push(`\t\t\t"helmet"\t\t"${helmet}"`);
    lines.push('\t\t\t"MatchStats"');
    lines.push('\t\t\t{');
    lines.push('\t\t\t\t"Totals"');
    lines.push('\t\t\t\t{');
    lines.push(`\t\t\t\t\t"Kills"\t\t"${kills}"`);
    lines.push(`\t\t\t\t\t"Damage"\t\t"${kills * 100}"`);
    lines.push('\t\t\t\t\t"EquipmentValue"\t\t"1000"');
    lines.push('\t\t\t\t\t"KillReward"\t\t"300"');
    lines.push('\t\t\t\t\t"LiveTime"\t\t"60"');
    lines.push(`\t\t\t\t\t"Deaths"\t\t"${deaths}"`);
    lines.push(`\t\t\t\t\t"Assists"\t\t"${assists}"`);
    lines.push(`\t\t\t\t\t"HeadshotKills"\t\t"${Math.floor(kills / 2)}"`);
    lines.push('\t\t\t\t\t"Objective"\t\t"0"');
    lines.push(`\t\t\t\t\t"CashEarned"\t\t"${cash}"`);
    lines.push('\t\t\t\t}');
    lines.push('\t\t\t}');
    lines.push('\t\t}');
  }

  /**
   * Analyse et extrait les données d'un fichier backup VDF natif Valve CS2
   */
  parseValveBackup(vdfText: string): ParsedValveBackup {
    const tree = this.parseVdfKeyValues(vdfText);
    const root = tree['SaveFile'] || tree;

    const round = parseInt(root['round'] ?? '0', 10);
    const team1 = root['team1'] ?? 'Team 1';
    const team2 = root['team2'] ?? 'Team 2';
    const map = root['map'] ?? 'unknown';
    const timestamp = root['timestamp'] ?? '';

    // FirstHalfScore
    const fh = root['FirstHalfScore'] || {};
    const firstHalfScore = {
      team1: parseInt(fh['team1'] ?? '0', 10) || 0,
      team2: parseInt(fh['team2'] ?? '0', 10) || 0,
    };

    // SecondHalfScore
    let secondHalfScore: { team1: number; team2: number } | undefined;
    if (root['SecondHalfScore']) {
      secondHalfScore = {
        team1: parseInt(root['SecondHalfScore']['team1'] ?? '0', 10) || 0,
        team2: parseInt(root['SecondHalfScore']['team2'] ?? '0', 10) || 0,
      };
    }

    // OvertimeScore
    let overtimeScore: { team1: number; team2: number; overtimeId?: number } | undefined;
    if (root['OvertimeScore']) {
      overtimeScore = {
        team1: parseInt(root['OvertimeScore']['team1'] ?? '0', 10) || 0,
        team2: parseInt(root['OvertimeScore']['team2'] ?? '0', 10) || 0,
        overtimeId: parseInt(root['OvertimeScore']['OvertimeID'] ?? '1', 10) || 1,
      };
    }

    // RoundResults
    const roundResults: Record<number, number> = {};
    const rr = root['RoundResults'] || {};
    for (const [k, v] of Object.entries(rr)) {
      const match = k.match(/round(\d+)/i);
      if (match) {
        roundResults[parseInt(match[1], 10)] = parseInt(String(v), 10);
      }
    }

    // Players
    const playersTeam1 = this.extractPlayers(root['PlayersOnTeam1']);
    const playersTeam2 = this.extractPlayers(root['PlayersOnTeam2']);

    return {
      round,
      team1,
      team2,
      map,
      timestamp,
      firstHalfScore,
      secondHalfScore,
      overtimeScore,
      roundResults,
      playersTeam1,
      playersTeam2,
      raw: root,
    };
  }

  private extractPlayers(container: any): ValveBackupPlayer[] {
    if (!container || typeof container !== 'object') return [];
    const players: ValveBackupPlayer[] = [];

    for (const [steamId, val] of Object.entries(container)) {
      if (typeof val === 'object' && val !== null) {
        const p = val as Record<string, any>;
        players.push({
          steamId,
          name: p['name'] || steamId,
          cash: p['cash'] !== undefined ? parseInt(String(p['cash']), 10) : undefined,
          kills: p['kills'] !== undefined ? parseInt(String(p['kills']), 10) : undefined,
          assists: p['assists'] !== undefined ? parseInt(String(p['assists']), 10) : undefined,
          deaths: p['deaths'] !== undefined ? parseInt(String(p['deaths']), 10) : undefined,
          mvps: p['mvps'] !== undefined ? parseInt(String(p['mvps']), 10) : undefined,
          score: p['score'] !== undefined ? parseInt(String(p['score']), 10) : undefined,
          roundsWon: p['roundsWon'] !== undefined ? parseInt(String(p['roundsWon']), 10) : undefined,
          helmet: p['helmet'] !== undefined ? parseInt(String(p['helmet']), 10) : undefined,
        });
      }
    }

    return players;
  }

  /**
   * Tokenizer & Parser KeyValues (Valve VDF)
   */
  private parseVdfKeyValues(text: string): Record<string, any> {
    // Nettoyer les commentaires //
    const lines = text.split(/\r?\n/).map((l) => {
      const idx = l.indexOf('//');
      return idx >= 0 ? l.slice(0, idx) : l;
    });
    const cleaned = lines.join(' ');

    // Extraire les tokens (guillemets, accolades, mots simples)
    const regex = /"([^"\\]*(?:\\.[^"\\]*)*)"|([{}])|([^\s{}"]+)/g;
    const tokens: string[] = [];
    let match: RegExpExecArray | null;

    while ((match = regex.exec(cleaned)) !== null) {
      if (match[1] !== undefined) {
        // Chaîne entre guillemets
        tokens.push(match[1]);
      } else if (match[2] !== undefined) {
        // Accolade { ou }
        tokens.push(match[2]);
      } else if (match[3] !== undefined) {
        // Mot non quoté
        tokens.push(match[3]);
      }
    }

    let pos = 0;

    function parseBlock(): Record<string, any> {
      const obj: Record<string, any> = {};

      while (pos < tokens.length) {
        const token = tokens[pos++];
        if (token === '}') {
          break;
        }

        const key = token;
        if (pos >= tokens.length) break;

        const next = tokens[pos++];
        if (next === '{') {
          obj[key] = parseBlock();
        } else {
          obj[key] = next;
        }
      }

      return obj;
    }

    const root: Record<string, any> = {};
    while (pos < tokens.length) {
      const key = tokens[pos++];
      if (pos >= tokens.length) break;
      const next = tokens[pos++];
      if (next === '{') {
        root[key] = parseBlock();
      } else {
        root[key] = next;
      }
    }

    return root;
  }

  /**
   * Écrit le fichier de backup sur disque
   */
  async writeBackupFile(targetPath: string, content: string): Promise<string> {
    const dir = path.dirname(targetPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    await fs.promises.writeFile(targetPath, content, 'utf8');
    this.logger.log(`[ValveBackup] Backup écrit avec succès : ${targetPath} (${content.length} octets)`);
    return targetPath;
  }

  private formatTimestamp(d: Date): string {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }
}
