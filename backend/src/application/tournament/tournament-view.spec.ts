import { asciiPage, renderTournamentAscii, TournamentView, ViewMatch } from './tournament-view';

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
