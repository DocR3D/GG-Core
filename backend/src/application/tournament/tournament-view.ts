// src/application/tournament/tournament-view.ts
// Plain-text (ASCII) rendering of a tournament: what the admin needs to check groups, results and brackets,
// without any frontend. Pure function, unit-tested; served inside a bare <pre> page.

export interface ViewGame {
  order: number;
  mapName: string;
  scoreHome: number;
  scoreAway: number;
  status: string; // MapStatus
  source: string | null; // AUTOMATIC | MANUAL
  server: string | null;
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
  const home = m.home ?? '(à déterminer)';
  const away = m.away ?? '(à déterminer)';
  const finished = m.status === 'FINISHED';
  const live = m.status === 'LIVE';
  const score = finished || live ? `${m.scoreHome}-${m.scoreAway}` : ' - ';
  const state = m.isForfeit ? 'forfait' : finished ? 'terminé' : live ? 'EN COURS' : 'à jouer';
  const lines = [`${prefix}${pad(home, nameWidth)} ${padL(score, 5)}  ${pad(away, nameWidth)}  ${m.format}  ${state}`];
  for (const g of m.games) {
    const gScore = g.status === 'FINISHED' || g.status === 'LIVE' ? `${g.scoreHome}-${g.scoreAway}` : '';
    const src = g.source === 'AUTOMATIC' ? 'auto' : g.source === 'MANUAL' ? 'saisie admin' : '';
    const parts = [`game ${g.order}`, g.mapName, gScore, g.status === 'LIVE' ? 'EN COURS' : '', src, g.server ? `serveur ${g.server}` : '']
      .filter(Boolean);
    lines.push(`${' '.repeat(prefix.length + 4)}${parts.join('  ·  ')}`);
  }
  return lines;
}

export function renderTournamentAscii(t: TournamentView): string {
  const names = t.stages.flatMap((s) => [
    ...s.groups.flatMap((g) => g.standings.map((r) => r.team)),
    ...s.seeds,
    ...[...s.matches, ...s.groups.flatMap((g) => g.matches)].flatMap((m) => [m.home ?? '', m.away ?? '']),
  ]);
  const nameWidth = Math.max(14, ...names.map((n) => n.length), ...t.bonusMatches.flatMap((m) => [m.home?.length ?? 0, m.away?.length ?? 0]));
  const out: string[] = [];
  out.push(`${t.name} — ${t.game}`);
  out.push(`(généré le ${t.generatedAt.toLocaleString('fr-FR')} — F5 pour rafraîchir)`);

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
        out.push(...renderMatchLine(m, nameWidth, ` R${m.round}  `));
      }
    }

    if (s.seeds.length) {
      out.push('', 'Qualifiés (ordre des seeds) :');
      s.seeds.forEach((team, i) => out.push(` ${padL(i + 1, 2)}. ${team}`));
    }
    if (s.matches.length) {
      out.push('');
      for (const m of [...s.matches].sort((a, b) => a.round - b.round || (a.position ?? 0) - (b.position ?? 0))) {
        out.push(...renderMatchLine(m, nameWidth, ` R${m.round}  `));
      }
    }
  }

  if (t.bonusMatches.length) {
    out.push('', `=== Matchs bonus ${'='.repeat(50)}`);
    for (const m of t.bonusMatches) {
      const tag = m.placement ? `[${m.placement}e / ${m.placement + 1}e place] ` : m.countsInStats === false ? '[fun] ' : '';
      out.push(...renderMatchLine(m, nameWidth, ` ${tag}`));
    }
  }
  return out.join('\n') + '\n';
}

/** Minimal HTML page: no CSS, no script, just the text. */
export function asciiPage(title: string, body: string): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<!doctype html>\n<html lang="fr"><head><meta charset="utf-8"><title>${esc(title)}</title></head>\n<body><pre>${esc(body)}</pre></body></html>\n`;
}
