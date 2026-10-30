// src/application/tournament/tournament-view.ts
// Plain-text (ASCII) rendering of a tournament: what the admin needs to check groups, results and brackets,
// without any frontend. Pure function, unit-tested; served inside a bare <pre> page.

import { escapeHtml, htmlPage } from '@app/shared/html-page';

export interface ViewGame {
  order: number;
  mapName: string;
  scoreHome: number;
  scoreAway: number;
  status: string; // MapStatus
  source: string | null; // AUTOMATIC | MANUAL
  server: string | null;
  /** REPORTED | CONFIRMED | DISPUTED */
  resultStatus?: string | null;
}

export interface ViewMatch {
  id: string;
  round: number;
  position: number | null;
  home: string | null;
  away: string | null;
  format: string;
  status: string; // MatchStatus
  scoreHome: number;
  scoreAway: number;
  winner: string | null;
  isForfeit: boolean;
  games: ViewGame[];
  countsInStats?: boolean;
  placement?: number | null;
  /** UPPER | LOWER | FINAL (brackets), ROUND_ROBIN (groups) */
  bracket?: string;
  /** where a team still unknown comes from, e.g. "Vainq. H T1#3" */
  homeFrom?: string | null;
  awayFrom?: string | null;
  advantageHome?: number;
  /** bracket label, e.g. "H T2#1" */
  label?: string;
  /** where the winner goes (label + slot), to draw the bracket */
  winnerTo?: { label: string; slot: 'HOME' | 'AWAY' } | null;
}

export interface ViewStandingRow {
  rank: number;
  team: string;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  points: number;
  scoreDiff: number;
  tied: boolean;
}

export interface ViewStage {
  name: string;
  type: string;
  order: number;
  groups: { name: string; standings: ViewStandingRow[]; matches: ViewMatch[] }[];
  /** participants without group (qualified teams waiting for a bracket), in seed order */
  seeds: string[];
  /** matches outside any group (brackets) */
  matches: ViewMatch[];
  /** final placements of a bracket stage (teams placed so far) */
  ranking?: { place: string; team: string }[];
}

export interface TournamentView {
  name: string;
  game: string;
  stages: ViewStage[];
  bonusMatches: ViewMatch[];
  generatedAt: Date;
}

const pad = (s: string | number, n: number) => String(s).padEnd(n);
const padL = (s: string | number, n: number) => String(s).padStart(n);
const signed = (n: number) => (n > 0 ? `+${n}` : String(n));

function renderMatchLine(m: ViewMatch, nameWidth: number, prefix: string): string[] {
  const home = m.home ?? (m.homeFrom ? `(${m.homeFrom})` : '(à déterminer)');
  const away = m.away ?? (m.awayFrom ? `(${m.awayFrom})` : '(à déterminer)');
  const finished = m.status === 'FINISHED';
  const live = m.status === 'LIVE';
  const score = finished || live ? `${m.scoreHome}-${m.scoreAway}` : ' - ';
  const state = m.isForfeit ? 'forfait' : finished ? 'terminé' : live ? 'EN COURS' : 'à jouer';
  const lines = [`${prefix}${pad(home, nameWidth)} ${padL(score, 5)}  ${pad(away, nameWidth)}  ${m.format}  ${state}`];
  for (const g of m.games) {
    const gScore = g.status === 'FINISHED' || g.status === 'LIVE' ? `${g.scoreHome}-${g.scoreAway}` : '';
    const src = g.source === 'AUTOMATIC' ? 'auto' : g.source === 'MANUAL' ? 'saisie admin' : '';
    const parts = [`game ${g.order}`, g.mapName, gScore, g.status === 'LIVE' ? 'EN COURS' : '', src, g.server ? `serveur ${g.server}` : '',
      g.resultStatus === 'DISPUTED' ? '⚠ contesté (à arbitrer)' : '']
      .filter(Boolean);
    lines.push(`${' '.repeat(prefix.length + 4)}${parts.join('  ·  ')}`);
  }
  return lines;
}

/** A link on a match label inside a rendered line (column / length in characters). */
interface LineLink {
  line: number;
  col: number;
  len: number;
  matchId: string;
}

export function renderTournamentAscii(t: TournamentView): string {
  return buildTournamentLines(t).lines.join('\n') + '\n';
}

/** Same text as renderTournamentAscii, as HTML: every match label is a link to its detail page. */
export function renderTournamentHtml(t: TournamentView, matchHref: (matchId: string) => string): string {
  const { lines, links } = buildTournamentLines(t);
  return lines.map((text, i) => linkify(text, links.filter((l) => l.line === i), matchHref)).join('\n') + '\n';
}

function linkify(text: string, links: { col: number; len: number; matchId: string }[], href: (id: string) => string): string {
  const chars = [...text]; // columns are characters (box drawing, accents)
  let html = '';
  let pos = 0;
  for (const l of [...links].sort((a, b) => a.col - b.col)) {
    if (l.col < pos) continue;
    html += escapeHtml(chars.slice(pos, l.col).join(''));
    html += `<a href="${escapeHtml(href(l.matchId))}">${escapeHtml(chars.slice(l.col, l.col + l.len).join(''))}</a>`;
    pos = l.col + l.len;
  }
  return html + escapeHtml(chars.slice(pos).join(''));
}


function buildTournamentLines(t: TournamentView): { lines: string[]; links: LineLink[] } {
  const names = t.stages.flatMap((s) => [
    ...s.groups.flatMap((g) => g.standings.map((r) => r.team)),
    ...s.seeds,
    ...[...s.matches, ...s.groups.flatMap((g) => g.matches)].flatMap((m) => [
      m.home ?? (m.homeFrom ? `(${m.homeFrom})` : ''),
      m.away ?? (m.awayFrom ? `(${m.awayFrom})` : ''),
    ]),
  ]);
  const nameWidth = Math.max(14, ...names.map((n) => n.length), ...t.bonusMatches.flatMap((m) => [m.home?.length ?? 0, m.away?.length ?? 0]));
  const out: string[] = [];
  const links: LineLink[] = [];
  /** Adds a match's lines; the link goes on its label (the prefix), or on its score when there is no label. */
  const pushMatch = (m: ViewMatch, prefix: string) => {
    const label = prefix.trim();
    const col = label ? prefix.indexOf(label) : prefix.length + nameWidth + 1;
    links.push({ line: out.length, col, len: label ? label.length : 5, matchId: m.id });
    out.push(...renderMatchLine(m, nameWidth, prefix));
  };
  out.push(`${t.name} - ${t.game}`);
  out.push(`(généré le ${t.generatedAt.toLocaleString('fr-FR')} - F5 pour rafraîchir)`);

  for (const s of [...t.stages].sort((a, b) => a.order - b.order)) {
    out.push('', `=== ${s.order}. ${s.name} (${s.type}) ${'='.repeat(Math.max(3, 60 - s.name.length))}`);
    if (!s.groups.length && !s.seeds.length && !s.matches.length) out.push('  (vide)');

    for (const g of s.groups) {
      out.push('', `Poule ${g.name}`.padEnd(nameWidth + 6) + '   J   V   N   D  Pts   Diff');
      for (const r of g.standings) {
        out.push(
          ` ${padL(r.rank, 2)}. ${pad(r.team, nameWidth + 1)} ${padL(r.played, 3)} ${padL(r.wins, 3)} ${padL(r.draws, 3)} ${padL(r.losses, 3)} ${padL(r.points, 4)} ${padL(signed(r.scoreDiff), 6)}` +
            (r.tied ? '   ⚠ égalité à trancher' : ''),
        );
      }
      out.push('');
      for (const m of [...g.matches].sort((a, b) => a.round - b.round || (a.position ?? 0) - (b.position ?? 0))) {
        pushMatch(m, ` R${m.round}  `);
      }
    }

    if (s.seeds.length) {
      out.push('', 'Qualifiés (ordre des seeds) :');
      s.seeds.forEach((team, i) => out.push(` ${padL(i + 1, 2)}. ${team}`));
    }
    const sections: [string, string, string][] = [
      ['UPPER', 'Bracket du haut', 'H'],
      ['LOWER', 'Bracket du bas', 'B'],
      ['FINAL', 'Grande finale', 'GF'],
    ];
    for (const [bracket, title, short] of sections) {
      const ms = s.matches.filter((m) => m.bracket === bracket);
      if (!ms.length) continue;
      const extra = bracket === 'FINAL' && ms[0].advantageHome ? ` (${ms[0].format}, +${ms[0].advantageHome} map pour le finaliste du haut)` : '';
      out.push('', `--- ${title}${extra}`, '');
      const treeLinks: { row: number; col: number; len: number; matchId: string }[] = [];
      const treeStart = out.length;
      out.push(...renderBracketTree(ms, nameWidth + 2, treeLinks));
      links.push(...treeLinks.map((l) => ({ line: treeStart + l.row, col: l.col, len: l.len, matchId: l.matchId })));
      out.push('', `    Détail des matchs (${title.toLowerCase()})`);
      let round = -1;
      for (const m of [...ms].sort((a, b) => a.round - b.round || (a.position ?? 0) - (b.position ?? 0))) {
        if (bracket !== 'FINAL' && m.round !== round) {
          round = m.round;
          out.push(`  Tour ${round}`);
        }
        const label = bracket === 'FINAL' ? 'GF      ' : `${short} T${m.round}#${m.position}`.padEnd(8);
        pushMatch(m, `   ${label} `);
      }
    }
    const others = s.matches.filter((m) => !['UPPER', 'LOWER', 'FINAL'].includes(m.bracket ?? ''));
    if (others.length) {
      out.push('');
      for (const m of [...others].sort((a, b) => a.round - b.round || (a.position ?? 0) - (b.position ?? 0))) {
        pushMatch(m, ` R${m.round}  `);
      }
    }
    if (s.ranking?.length) {
      out.push('', 'Classement final (équipes placées) :');
      for (const r of s.ranking) out.push(` ${r.place.padStart(5)}. ${r.team}`);
    }
  }

  if (t.bonusMatches.length) {
    out.push('', `=== Matchs bonus ${'='.repeat(50)}`);
    for (const m of t.bonusMatches) {
      const tag = m.placement ? `[${m.placement}e / ${m.placement + 1}e place] ` : m.countsInStats === false ? '[fun] ' : '';
      pushMatch(m, ` ${tag}`);
    }
  }
  return { lines: out, links };
}

/** Minimal HTML page: no CSS, no script, just the text. */
export function asciiPage(title: string, body: string, bodyIsHtml = false, refreshSec?: number): string {
  // optional auto refresh (e.g. to follow a simulated tournament): still no script
  return htmlPage({ title, body: `<pre>${bodyIsHtml ? body : escapeHtml(body)}</pre>`, refreshSec });
}

/**
 * Draws one bracket section (upper or lower) as columns, one per round: every match is two lines (home / away,
 * winner marked ✓), the next match sits between the matches feeding it, and lines join each winner to its slot
 * in the next round. Teams coming from elsewhere (upper-bracket losers dropping down, byes) show their origin.
 */
export function renderBracketTree(
  matches: ViewMatch[],
  nameWidth: number,
  links?: { row: number; col: number; len: number; matchId: string }[],
): string[] {
  if (!matches.length) return [];
  const sorted = [...matches].sort((a, b) => a.round - b.round || (a.position ?? 0) - (b.position ?? 0));
  const rounds = [...new Set(sorted.map((m) => m.round))];
  const byLabel = new Map(sorted.map((m) => [m.label ?? m.id, m]));
  const children = new Map<string, ViewMatch[]>();
  for (const m of sorted) {
    if (m.winnerTo && byLabel.has(m.winnerTo.label)) {
      children.set(m.winnerTo.label, [...(children.get(m.winnerTo.label) ?? []), m]);
    }
  }

  // Vertical position: leaves stacked 4 lines apart, a match fed by others sits between them
  const y = new Map<ViewMatch, number>();
  let nextFree = 1;
  for (const m of sorted) {
    const kids = (children.get(m.label ?? m.id) ?? []).filter((k) => y.has(k));
    if (kids.length) y.set(m, Math.round(kids.reduce((s, k) => s + y.get(k)!, 0) / kids.length));
    else {
      y.set(m, nextFree);
      nextFree += 4;
    }
  }

  const cellWidth = nameWidth + 6; // name, score, winner mark
  const gap = 3;
  const colX = (m: ViewMatch) => rounds.indexOf(m.round) * (cellWidth + gap);
  const height = Math.max(...[...y.values()]) + 2;
  const width = rounds.length * (cellWidth + gap);
  const grid: string[][] = Array.from({ length: height }, () => Array(width).fill(' '));
  const put = (row: number, col: number, text: string) => {
    for (let i = 0; i < text.length && col + i < width; i++) if (row >= 0 && row < height) grid[row][col + i] = text[i];
  };

  for (const m of sorted) {
    const x = colX(m);
    const top = y.get(m)!;
    const played = m.status === 'FINISHED' || m.status === 'LIVE';
    const line = (name: string | null, from: string | null | undefined, score: number) => {
      // ↓ = team that dropped from the upper bracket into a later lower round (in round 1 everyone did)
      const dropped = m.round > 1 && from?.startsWith('Perd.');
      const label = name ? (dropped ? `↓ ${name}` : name) : from ? `(${from})` : '(à déterminer)';
      const winner = m.status === 'FINISHED' && m.winner !== null && name === m.winner;
      const shown = label.length > nameWidth ? label.slice(0, nameWidth - 1) + '…' : label;
      return `${shown.padEnd(nameWidth)} ${played ? String(score).padStart(2) : '  '}${winner ? ' ✓' : '  '}`;
    };
    put(top - 1, x, `${m.label ?? ''} ${m.format}${m.isForfeit ? ' forfait' : ''}${m.status === 'LIVE' ? ' EN COURS' : ''}`.slice(0, cellWidth));
    if (m.label) links?.push({ row: top - 1, col: x, len: m.label.length, matchId: m.id });
    put(top, x, line(m.home, m.homeFrom, m.scoreHome));
    put(top + 1, x, line(m.away, m.awayFrom, m.scoreAway));

    // Line from this match to its slot in the next round
    const parent = m.winnerTo ? byLabel.get(m.winnerTo.label) : undefined;
    if (!parent || !y.has(parent)) continue;
    const target = y.get(parent)! + (m.winnerTo!.slot === 'HOME' ? 0 : 1);
    // The line leaves from the winner's row once known, otherwise from the row closest to the target
    const winnerRow = m.status === 'FINISHED' && m.winner !== null ? (m.winner === m.home ? top : top + 1) : null;
    const out = winnerRow ?? (target > top + 1 ? top + 1 : target < top ? top : target);
    const gx = x + cellWidth;
    put(out, gx, '─');
    if (out === target) put(out, gx + 1, '─');
    else if (out < target) {
      put(out, gx + 1, '┐');
      for (let r = out + 1; r < target; r++) put(r, gx + 1, '│');
      put(target, gx + 1, '└');
    } else {
      put(out, gx + 1, '┘');
      for (let r = target + 1; r < out; r++) put(r, gx + 1, '│');
      put(target, gx + 1, '┌');
    }
    put(target, gx + 2, '─');
  }
  return grid.map((row) => row.join('').trimEnd());
}

// ---------------------------------------------------------------------------------------------------------
// Match detail page
// ---------------------------------------------------------------------------------------------------------

export interface MatchRef {
  id: string;
  label: string;
}

export interface MatchDetailView {
  id: string;
  tournament: { id: string; name: string };
  context: string; // e.g. "Élite - Bracket du haut", "Poules - Poule A", "Match bonus"
  label: string;
  format: string;
  status: string;
  home: string | null;
  away: string | null;
  scoreHome: number;
  scoreAway: number;
  winner: string | null;
  isForfeit: boolean;
  advantageHome: number;
  countsInStats: boolean;
  placement: number | null;
  from: { slot: 'HOME' | 'AWAY'; what: 'Vainq.' | 'Perd.'; match: MatchRef }[];
  next: { what: 'vainqueur' | 'perdant'; slot: 'HOME' | 'AWAY' | null; match: MatchRef }[];
  games: {
    order: number;
    mapName: string;
    status: string;
    scoreHome: number;
    scoreAway: number;
    source: string | null;
    resultStatus: string | null;
    reportedBy: string | null;
    reportedAt: Date | null;
    server: string | null;
    stats: { team: string; player: string; kills: number; deaths: number; assists: number; headshots: number; adr: number }[];
  }[];
}

const slotFr = (slot: 'HOME' | 'AWAY' | null) => (slot === 'HOME' ? 'domicile' : slot === 'AWAY' ? 'extérieur' : '');
const statusFr = (s: string) =>
  ({ PENDING: 'à jouer', LIVE: 'en cours', FINISHED: 'terminé', CANCELLED: 'non joué', VETO: 'véto', WARMUP: 'warmup', PAUSED: 'en pause' } as Record<string, string>)[s] ?? s;

/** Detail of one match, as HTML (links to the tournament and to the matches before / after it in the bracket). */
export function renderMatchDetailHtml(d: MatchDetailView, tournamentHref: string, matchHref: (id: string) => string): string {
  const lines: string[] = [];
  const links: { line: number; col: number; len: number; href: string }[] = [];
  const link = (text: string, href: string, prefix = '') => {
    links.push({ line: lines.length, col: [...prefix].length, len: [...text].length, href });
    lines.push(prefix + text);
  };
  const width = Math.max(14, d.home?.length ?? 0, d.away?.length ?? 0);

  link(`← ${d.tournament.name}`, tournamentHref);
  lines.push('');
  lines.push(`${d.context} - ${d.label} - ${d.format} - ${d.isForfeit ? 'forfait' : statusFr(d.status)}`);
  if (d.placement) lines.push(`Match de classement : ${d.placement}e / ${d.placement + 1}e place`);
  if (!d.countsInStats) lines.push('Match bonus : stats hors classements officiels');
  lines.push('');
  const played = d.status !== 'PENDING';
  const team = (name: string | null, score: number, extra: string) =>
    `  ${(name ?? '(à déterminer)').padEnd(width)}  ${played ? String(score).padStart(2) : '  '}${name && name === d.winner ? '  ✓ vainqueur' : ''}${extra}`;
  lines.push(team(d.home, d.scoreHome, d.advantageHome ? `   (dont +${d.advantageHome} map d'avance)` : ''));
  lines.push(team(d.away, d.scoreAway, ''));

  if (d.from.length) {
    lines.push('', "D'où viennent les équipes");
    for (const f of d.from) {
      const prefix = `  ${slotFr(f.slot).padEnd(10)} ${f.what} `;
      link(f.match.label, matchHref(f.match.id), prefix);
    }
  }
  if (d.next.length) {
    lines.push('', 'Où vont les équipes');
    for (const n of d.next) {
      const prefix = `  ${n.what.padEnd(10)} → `;
      links.push({ line: lines.length, col: [...prefix].length, len: [...n.match.label].length, href: matchHref(n.match.id) });
      lines.push(`${prefix}${n.match.label}${n.slot ? ` (${slotFr(n.slot)})` : ''}`);
    }
  } else if (d.status === 'FINISHED' && /^(H |B |GF)/.test(d.label)) {
    // bracket match with no next match: grand final, or lower-bracket match (its loser is out)
    lines.push('', 'Fin de parcours dans l’arbre (finale, ou élimination du perdant).');
  }

  lines.push('');
  link('Véto des maps (pierre-feuille-ciseaux, bans et picks)', `/veto/${d.id}`);
  lines.push('', 'Games');
  if (!d.games.length) lines.push('  (aucun game joué)');
  for (const g of d.games) {
    const who = g.source === 'AUTOMATIC' ? `auto (${g.reportedBy ?? 'moteur'})` : g.source === 'MANUAL' ? `saisie de ${g.reportedBy ?? 'admin'}` : '';
    const when = g.reportedAt ? g.reportedAt.toLocaleString('fr-FR') : '';
    const score = g.status === 'FINISHED' || g.status === 'LIVE' ? `${g.scoreHome}-${g.scoreAway}` : '';
    lines.push(
      `  ${g.order}. ${g.mapName.padEnd(12)} ${score.padEnd(6)} ${statusFr(g.status).padEnd(9)} ${who}${when ? `, ${when}` : ''}${g.server ? `  · serveur ${g.server}` : ''}` +
        (g.resultStatus && g.resultStatus !== 'CONFIRMED' ? `  [${g.resultStatus}]` : ''),
    );
    if (g.stats.length) {
      const pw = Math.max(10, ...g.stats.map((r) => r.player.length));
      lines.push(`     ${'Joueur'.padEnd(pw)}   K   D   A  HS   ADR`);
      let current = '';
      for (const r of [...g.stats].sort((a, b) => a.team.localeCompare(b.team) || b.kills - a.kills)) {
        if (r.team !== current) {
          current = r.team;
          lines.push(`     ${r.team}`);
        }
        lines.push(`     ${r.player.padEnd(pw)} ${String(r.kills).padStart(3)} ${String(r.deaths).padStart(3)} ${String(r.assists).padStart(3)} ${String(r.headshots).padStart(3)} ${r.adr.toFixed(1).padStart(5)}`);
      }
    }
  }

  const body = lines
    .map((text, i) => linkify(text, links.filter((l) => l.line === i).map((l) => ({ ...l, matchId: l.href })), (h) => h))
    .join('\n');
  return asciiPage(`${d.label} - ${d.tournament.name}`, body + '\n', true);
}
