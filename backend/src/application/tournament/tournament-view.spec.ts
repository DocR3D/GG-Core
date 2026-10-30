import { asciiPage, MatchDetailView, renderBracketTree, renderMatchDetailHtml, renderTournamentAscii, renderTournamentHtml, TournamentView, ViewMatch } from './tournament-view';

const match = (over: Partial<ViewMatch>): ViewMatch => ({
  id: 'm', round: 1, position: 1, home: 'Alpha', away: 'Bravo', format: 'BO1', status: 'PENDING',
  scoreHome: 0, scoreAway: 0, winner: null, isForfeit: false, games: [], ...over,
});

const view: TournamentView = {
  name: 'GGLan IT',
  game: 'cs2',
  generatedAt: new Date('2026-10-30T12:00:00Z'),
  stages: [
    {
      name: 'Poules', type: 'ROUND_ROBIN', order: 1, seeds: [], matches: [],
      groups: [{
        name: 'A',
        standings: [
          { rank: 1, team: 'Alpha', played: 1, wins: 1, draws: 0, losses: 0, points: 3, scoreDiff: 2, tied: false },
          { rank: 2, team: 'Bravo', played: 1, wins: 0, draws: 0, losses: 1, points: 0, scoreDiff: -2, tied: true },
        ],
        matches: [
          match({ status: 'FINISHED', scoreHome: 1, scoreAway: 0, winner: 'Alpha',
            games: [{ order: 1, mapName: 'de_mirage', scoreHome: 13, scoreAway: 11, status: 'FINISHED', source: 'AUTOMATIC', server: 'srv-a' }] }),
          match({ round: 2, home: 'Bravo', away: 'Alpha' }),
        ],
      }],
    },
    { name: 'Élite', type: 'DOUBLE_ELIM', order: 2, groups: [], matches: [], seeds: ['Alpha', 'Bravo'] },
  ],
  bonusMatches: [match({ id: 'b', home: 'Bravo', away: 'Alpha', placement: 7, countsInStats: true })],
};

describe('renderTournamentAscii', () => {
  const text = renderTournamentAscii(view);

  it('affiche le classement, les égalités à trancher et les matchs avec leurs games', () => {
    expect(text).toContain('GGLan IT — cs2');
    expect(text).toMatch(/1\. Alpha\s+1\s+1\s+0\s+0\s+3\s+\+2/);
    expect(text).toContain('⚠ égalité à trancher');
    expect(text).toMatch(/R1\s+Alpha\s+1-0\s+Bravo\s+BO1\s+terminé/);
    expect(text).toContain('game 1  ·  de_mirage  ·  13-11  ·  auto  ·  serveur srv-a');
    expect(text).toMatch(/R2\s+Bravo\s+-\s+Alpha\s+BO1\s+à jouer/);
  });

  it('affiche les qualifiés d’une phase sans matchs et les matchs bonus (classement)', () => {
    expect(text).toContain('Qualifiés (ordre des seeds) :');
    expect(text).toMatch(/2\. Bravo/);
    expect(text).toContain('[7e / 8e place]');
  });

  it('page HTML sans CSS ni script, texte échappé', () => {
    const html = asciiPage('<T>', 'a < b');
    expect(html).toContain('<pre>a &lt; b</pre>');
    expect(html).not.toMatch(/<style|<script|style=/);
  });
});

describe('renderBracketTree', () => {
  const m = (label: string, round: number, position: number, over: Partial<ViewMatch>): ViewMatch => ({
    id: label, label, round, position, home: null, away: null, format: 'BO1', status: 'PENDING',
    scoreHome: 0, scoreAway: 0, winner: null, isForfeit: false, games: [], ...over,
  });

  it('dessine les tours en colonnes, relie chaque vainqueur à sa place et marque les arrivées du haut', () => {
    const lines = renderBracketTree([
      m('B T1#1', 1, 1, { home: 'Alpha', away: 'Bravo', status: 'FINISHED', scoreHome: 1, winner: 'Alpha', winnerTo: { label: 'B T2#1', slot: 'HOME' } }),
      m('B T2#1', 2, 1, { home: 'Alpha', away: 'Delta', awayFrom: 'Perd. H T2#1' }),
    ], 12);
    const text = lines.join('\n');
    expect(text).toMatch(/Alpha\s+1 ✓ ─+Alpha/); // winner line joined to its slot in the next round
    expect(text).toContain('↓ Delta'); // dropped from the upper bracket
    expect(text).toContain('B T2#1 BO1');
  });

  it('montre l’origine d’une équipe encore inconnue', () => {
    const text = renderBracketTree([m('GF', 1, 1, { homeFrom: 'Vainq. H T4#1', awayFrom: 'Vainq. B T6#1' })], 16).join('\n');
    expect(text).toContain('(Vainq. H T4#1)');
  });
});

describe('pages HTML avec liens', () => {
  it('vue du tournoi : chaque libellé de match est un lien vers sa page de détail, le texte reste identique', () => {
    const html = renderTournamentHtml(view, (id) => `../../matches/${id}/view`);
    expect(html).toContain('<a href="../../matches/m/view">R1</a>');
    expect(html.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'))
      .toBe(renderTournamentAscii(view));
  });

  it('page d’un match : retour au tournoi, provenance et suite cliquables, games avec auteur et serveur', () => {
    const detail: MatchDetailView = {
      id: 'x', tournament: { id: 't', name: 'GGLan IT' }, context: 'Élite — Bracket du haut', label: 'H T2#1',
      format: 'BO3', status: 'FINISHED', home: 'Alpha', away: 'Bravo', scoreHome: 2, scoreAway: 1, winner: 'Alpha',
      isForfeit: false, advantageHome: 0, countsInStats: true, placement: null,
      from: [{ slot: 'HOME', what: 'Vainq.', match: { id: 'a', label: 'H T1#1' } }],
      next: [{ what: 'perdant', slot: 'AWAY', match: { id: 'b', label: 'B T2#4' } }],
      games: [{
        order: 1, mapName: 'de_mirage', status: 'FINISHED', scoreHome: 13, scoreAway: 11, source: 'AUTOMATIC',
        resultStatus: 'CONFIRMED', reportedBy: 'cs2', reportedAt: null, server: 'srv-a',
        stats: [{ team: 'Alpha', player: 'Player_01', kills: 20, deaths: 12, assists: 4, headshots: 9, adr: 88.4 }],
      }],
    };
    const html = renderMatchDetailHtml(detail, '../../tournaments/t/view', (id) => `../${id}/view`);
    expect(html).toContain('<a href="../../tournaments/t/view">← GGLan IT</a>');
    expect(html).toContain('<a href="../a/view">H T1#1</a>');
    expect(html).toContain('<a href="../b/view">B T2#4</a> (extérieur)');
    expect(html).toContain('auto (cs2)');
    expect(html).toContain('serveur srv-a');
    expect(html).toMatch(/Player_01\s+20\s+12\s+4\s+9\s+88\.4/);
    expect(html).not.toMatch(/<style|<script|style=/);
  });
});
