// Lines of the match console's event log, from the stored history (events_primary types: kill, team_round_win…)
// and from the live WebSocket (kill, chat:public, admin:action…): both are turned into the same short French line.

export interface LogLine {
  key: string;
  at: number;
  text: string;
  tone: 'normal' | 'muted' | 'admin' | 'alert';
}

const ACTION: Record<string, string> = {
  pause: 'pause technique',
  unpause: 'reprise',
  force_start: 'départ forcé',
  swap_teams: 'échange des camps',
  restore_round: 'round rejoué',
  say: 'message',
};
const REASON: Record<string, string> = {
  elim: 'élimination',
  bomb: 'bombe',
  bomb_exploded: 'bombe',
  defused: 'désamorçage',
  time: 'temps écoulé',
  draw: 'nul',
};
const side = (t?: string) => (t === 'TERRORIST' || t === 'T' ? 'T' : t === 'CT' ? 'CT' : t ?? '?');
const who = (p: any) => p?.name ?? '?';

/** null = not worth a line (raw logs, purchases, grenades, agent traffic…). */
export function describe(type: string, p: any): Omit<LogLine, 'key' | 'at'> | null {
  const t = type.replace(':', '_');
  switch (t) {
    case 'kill':
      if (p?.kind === 'player') return { text: `${who(p.killer)} tue ${who(p.victim)} (${p.weapon ?? '?'}${p.headshot ? ', headshot' : ''})`, tone: 'normal' };
      if (p?.kind === 'suicide') return { text: `${who(p.player)} meurt (${p.weapon ?? 'suicide'})`, tone: 'muted' };
      return null;
    case 'team_round_win':
      return { text: `Round gagné par ${side(p?.winner)}${p?.reason ? ` (${REASON[p.reason] ?? p.reason})` : ''}`, tone: 'normal' };
    case 'round_start':
      return { text: 'Début du round', tone: 'muted' };
    case 'bomb_planted':
      return { text: `Bombe posée${p?.site ? ` en ${p.site}` : ''}${p?.planter ? ` par ${who(p.planter)}` : ''}`, tone: 'normal' };
    case 'bomb_defused':
      return { text: `Bombe désamorcée${p?.defuser ? ` par ${who(p.defuser)}` : ''}`, tone: 'normal' };
    case 'chat_public':
    case 'chat_message':
      return { text: `${who(p?.player)} : ${p?.message ?? ''}`, tone: 'muted' };
    case 'command':
      return { text: `${who(p?.sender)} : !${String(p?.command ?? '').replace(/^!/, '')}`, tone: 'muted' };
    case 'pause_update':
      return { text: p?.state === 'paused' ? 'Match en pause' : 'Reprise du match', tone: 'normal' };
    case 'match_paused':
      return { text: 'Match en pause', tone: 'normal' };
    case 'match_unpaused':
      return { text: 'Reprise du match', tone: 'normal' };
    case 'phase_changed':
      return { text: `Phase : ${p?.to ?? p?.phase ?? p?.next ?? '?'}`, tone: 'normal' };
    case 'admin_action':
      return { text: `Admin ${p?.by ?? '?'} : ${ACTION[p?.action] ?? p?.action}${p?.round ? ` ${p.round}` : ''}${p?.message ? ` « ${p.message} »` : ''}`, tone: 'admin' };
    case 'player_connected':
      return { text: `${who(p?.player)} se connecte`, tone: 'muted' };
    case 'player_disconnected':
      return { text: `${who(p?.player)} se déconnecte`, tone: 'muted' };
    case 'access_not_allowed':
      return { text: `${who(p?.player)} n'est pas inscrit${p?.kicked ? ' : kické' : ''}`, tone: 'alert' };
    case 'sides_misplaced':
      return { text: `Mauvais camp : ${(p?.misplaced ?? []).map((m: any) => m.name ?? m.steamId).join(', ')}`, tone: 'alert' };
    case 'match_review_required':
      return { text: 'Résultat gelé : le Game Over du serveur contredit GG-Core', tone: 'alert' };
    case 'game_over':
      return { text: `Game Over du serveur (${p?.scoreCT ?? '?'}-${p?.scoreT ?? '?'})`, tone: 'normal' };
    default:
      return null;
  }
}
