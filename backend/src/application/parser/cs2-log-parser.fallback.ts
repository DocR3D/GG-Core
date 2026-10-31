// src/application/parser/cs2-log-parser.fallback.ts

export function cleanContainerLogPrefix(line: string): string {
  const lIdx = line.indexOf('L ');
  if (lIdx !== -1 && lIdx < 40) {
    return line.slice(lIdx);
  }
  return line;
}

const fallbackIgnoreNextWorldSuicide = new Set<string>();

/** Same as NormTeam of the Go parser (events.go): CT, TERRORIST, Spectator, Unassigned. */
function normTeamLikeGo(team: string): string {
  const t = team.toLowerCase();
  if (t.startsWith('ct')) return 'CT';
  if (t.startsWith('t') || t.startsWith('terror')) return 'TERRORIST';
  if (t.startsWith('spec')) return 'Spectator';
  if (t === '' || t.startsWith('unass')) return 'Unassigned';
  return team;
}

/**
 * Parser de secours ultra-léger pour rejouer des logs même sans Agent Go actif
 */
export function parseCs2LineFallback(rawLine: string, matchId: string, serverId: string): any | null {
  let line = cleanContainerLogPrefix(rawLine).trim();
  line = line.replace(/^(?:L\s+)?\d{2}\/\d{2}\/\d{4}\s*-\s*\d{2}:\d{2}:\d{2}(?:\.\d{3})?\s*[-:]\s*/, '').trim();
  if (!line) return null;

  if (line.includes('World triggered "Match_Start"')) {
    fallbackIgnoreNextWorldSuicide.clear();
    return { type: 'match_start', matchId, serverId, timestamp: Date.now(), payload: {} };
  }

  // Game Over: competitive mg_active de_inferno score 5:7 after 29 min   (score is CT:T, map group optional)
  const gameOverMatch = line.match(/^Game Over:\s+(\S+)\s+(?:\S+\s+)?(\S+)\s+score\s+(\d+):(\d+)\s+after\s+(\d+)\s+min/);
  if (gameOverMatch) {
    return {
      type: 'game_over', matchId, serverId, timestamp: Date.now(),
      payload: {
        mode: gameOverMatch[1], map: gameOverMatch[2],
        scoreCT: Number(gameOverMatch[3]), scoreT: Number(gameOverMatch[4]), minutes: Number(gameOverMatch[5]),
      },
    };
  }

  if (line.includes('World triggered "Round_Start"')) {
    fallbackIgnoreNextWorldSuicide.clear();
    return { type: 'round_start', matchId, serverId, timestamp: Date.now(), payload: {} };
  }

  // Mort par la C4 : CS2 logge `was killed by the bomb.` puis `committed suicide with "world"`.
  // CS2 (round_stats) compte UNE mort : on l'émet ici et on ignore la ligne jumelle.
  // (miroir de agent/internal/parser/parser.go)
  const bombKilledMatch = line.match(/^"([^"<]+)<\d+><([^>]*)><([^>]+)>"(?:\s+\[[-\d\s]+\])?\s+was\s+killed\s+by\s+the\s+bomb\.?/);
  if (bombKilledMatch) {
    if (bombKilledMatch[2]) {
      fallbackIgnoreNextWorldSuicide.add(`${matchId}:${bombKilledMatch[2]}`);
    }
    return {
      type: 'kill',
      matchId,
      serverId,
      timestamp: Date.now(),
      payload: {
        kind: 'suicide',
        player: { name: bombKilledMatch[1], steamId: bombKilledMatch[2], team: bombKilledMatch[3] },
        weapon: 'bomb',
      },
    };
  }

  // Connexion d'un joueur (même payload que le parser Go) : userId = id de connexion du serveur, utilisé par kickid
  // (whitelist du match). Équipe vide → "Unassigned" comme NormTeam côté Go.
  const connMatch = line.match(/^"([^"<]+)<(\d+)><([^>]*)><([^>]*)>"\s+connected/);
  if (connMatch) {
    return {
      type: 'player_connected',
      matchId,
      serverId,
      timestamp: Date.now(),
      payload: {
        player: { name: connMatch[1], steamId: connMatch[3], team: connMatch[4] || 'Unassigned', userId: Number(connMatch[2]) },
      },
    };
  }

  // Changement de camp (arrivée dans une équipe, mp_swapteams, mi-temps) - même payload que le parser Go
  const teamMatch = line.match(/^"([^"<]+)<(\d+)><([^>]*)>"\s+switched from team <([^>]*)> to <([^>]*)>/);
  if (teamMatch) {
    return {
      type: 'player_switched_team',
      matchId,
      serverId,
      timestamp: Date.now(),
      payload: {
        player: { name: teamMatch[1], steamId: teamMatch[3], userId: Number(teamMatch[2]) },
        from: normTeamLikeGo(teamMatch[4]),
        to: normTeamLikeGo(teamMatch[5]),
      },
    };
  }

  // Déconnexion : le `committed suicide with "world"` qui suit EST une mort pour CS2 (round_stats),
  // il n'est donc plus ignoré.
  const discMatch = line.match(/^"([^"<]+)<\d+><([^>]*)><([^>]*)>"\s+disconnected/);
  if (discMatch && discMatch[2]) {
    return null;
  }

  // Round nul (`World triggered "SFUI_Notice_Round_Draw"`), émis notamment par un backup restore avec le score
  // restauré. Même payload que le parser Go : { winner: 'none', reason: 'draw', score }.
  const drawMatch = line.match(/^World triggered "SFUI_Notice_Round_Draw"(?:\s*\(CT "(\d+)"\)\s*\(T "(\d+)"\))?/);
  if (drawMatch) {
    return {
      type: 'team_round_win',
      matchId,
      serverId,
      timestamp: Date.now(),
      payload: {
        winner: 'none',
        reason: 'draw',
        ...(drawMatch[1] !== undefined ? { score: { ct: parseInt(drawMatch[1], 10), t: parseInt(drawMatch[2], 10) } } : {}),
      },
    };
  }

  const winMatch = line.match(/^Team "(TERRORIST|CT)" triggered "(SFUI_Notice_[A-Za-z_]+)"(?:\s*\(CT "(\d+)"\)\s*\(T "(\d+)"\))?/);
  if (winMatch) {
    const winner = winMatch[1] === 'TERRORIST' ? 'T' : 'CT';
    const sfui = winMatch[2].toLowerCase();
    const reason = sfui.includes('target_bombed')
      ? 'bomb_exploded'
      : ((sfui.includes('defused') || sfui.includes('target_saved')) ? 'defused' : 'elim');
    const scoreCT = winMatch[3] ? parseInt(winMatch[3], 10) : undefined;
    const scoreT = winMatch[4] ? parseInt(winMatch[4], 10) : undefined;
    const score = (scoreCT !== undefined && scoreT !== undefined) ? { ct: scoreCT, t: scoreT } : undefined;
    return {
      type: 'team_round_win',
      matchId,
      serverId,
      timestamp: Date.now(),
      payload: { winner, team: winner, reason, scoreCT, scoreT, ...(score ? { score } : {}) },
    };
  }

  const killMatch = line.match(/^"([^"<]+)<\d+><([^>]*)><([^>]+)>"(?:\s+\[[-\d\s]+\])?\s+killed\s+"([^"<]+)<\d+><([^>]*)><([^>]+)>"(?:\s+\[[-\d\s]+\])?\s+with\s+"([^"]+)"(.*)$/);
  if (killMatch) {
    const isHeadshot = Boolean(killMatch[8]?.includes('headshot'));
    const isTeamkill = Boolean(killMatch[8]?.includes('friendlyfire')) || (
      killMatch[3] === killMatch[6] && (killMatch[3] === 'CT' || killMatch[3] === 'TERRORIST' || killMatch[3] === 'T')
    );
    return {
      type: 'kill',
      matchId,
      serverId,
      timestamp: Date.now(),
      payload: {
        kind: 'player',
        killer: { name: killMatch[1], steamId: killMatch[2], team: killMatch[3] },
        victim: { name: killMatch[4], steamId: killMatch[5], team: killMatch[6] },
        weapon: killMatch[7],
        headshot: isHeadshot,
        ...(isTeamkill ? { teamkill: true } : {}),
      },
    };
  }

  const assistMatch = line.match(/^"([^"<]+)<\d+><([^>]*)><([^>]+)>"\s+(?:(flash)-)?assisted\s+killing\s+"([^"<]+)<\d+><([^>]*)><([^>]+)>"/);
  if (assistMatch) {
    const isFlash = Boolean(assistMatch[4]);
    return {
      type: 'assist',
      matchId,
      serverId,
      timestamp: Date.now(),
      payload: {
        player: { name: assistMatch[1], steamId: assistMatch[2], team: assistMatch[3] },
        victim: { name: assistMatch[5], steamId: assistMatch[6], team: assistMatch[7] },
        flashAssist: isFlash,
      },
    };
  }

  const suicideMatch = line.match(/^"([^"<]+)<\d+><([^>]*)><([^>]+)>"(?:\s+\[[-\d\s]+\])?\s+committed\s+suicide\s+with\s+"([^"]+)"/);
  if (suicideMatch) {
    const key = `${matchId}:${suicideMatch[2]}`;
    if (suicideMatch[4]?.toLowerCase() === 'world' && fallbackIgnoreNextWorldSuicide.has(key)) {
      fallbackIgnoreNextWorldSuicide.delete(key);
      return null;
    }
    return {
      type: 'kill',
      matchId,
      serverId,
      timestamp: Date.now(),
      payload: {
        kind: 'suicide',
        player: { name: suicideMatch[1], steamId: suicideMatch[2], team: suicideMatch[3] },
        weapon: suicideMatch[4],
      },
    };
  }

  const plantedMatch = line.match(/^"([^"<]+)<\d+><([^>]*)><([^>]+)>"\s+triggered\s+"Planted_The_Bomb"(?:\s+(?:at\s+bombsite|\(Site\))\s+(A|B)\)?)?/);
  if (plantedMatch) {
    return {
      type: 'bomb_planted',
      matchId,
      serverId,
      timestamp: Date.now(),
      payload: {
        planter: { name: plantedMatch[1], steamId: plantedMatch[2], team: plantedMatch[3] },
        ...(plantedMatch[4] ? { site: plantedMatch[4] } : {}),
      },
    };
  }

  const beginPlantMatch = line.match(/^"([^"<]+)<\d+><([^>]*)><([^>]+)>"\s+triggered\s+"Bomb_Begin_Plant"\s+at\s+bombsite\s+(A|B)/);
  if (beginPlantMatch) {
    return {
      type: 'begin_bomb_plant',
      matchId,
      serverId,
      timestamp: Date.now(),
      payload: {
        player: { name: beginPlantMatch[1], steamId: beginPlantMatch[2], team: beginPlantMatch[3] },
        site: beginPlantMatch[4],
      },
    };
  }

  const defusedMatch = line.match(/^"([^"<]+)<\d+><([^>]*)><([^>]+)>"\s+triggered\s+"Defused_The_Bomb"/);
  if (defusedMatch) {
    return {
      type: 'bomb_defused',
      matchId,
      serverId,
      timestamp: Date.now(),
      payload: {
        defuser: { name: defusedMatch[1], steamId: defusedMatch[2], team: defusedMatch[3] },
      },
    };
  }

  const defuseBeginMatch = line.match(/^"([^"<]+)<\d+><([^>]*)><([^>]+)>"\s+triggered\s+"Begin_Bomb_Defuse(?:_(With|Without)_Kit)?"/);
  if (defuseBeginMatch) {
    return {
      type: 'defuse_begin',
      matchId,
      serverId,
      timestamp: Date.now(),
      payload: {
        player: { name: defuseBeginMatch[1], steamId: defuseBeginMatch[2], team: defuseBeginMatch[3] },
        hasKit: defuseBeginMatch[4] === 'With',
      },
    };
  }

  if (line.includes('triggered "Aborted_Bomb_Defuse"')) {
    return { type: 'defuse_abort', matchId, serverId, timestamp: Date.now(), payload: {} };
  }

  if (line.includes('World triggered "Match_Start"')) {
    return { type: 'match_start', matchId, serverId, timestamp: Date.now(), payload: {} };
  }

  return null;
}
