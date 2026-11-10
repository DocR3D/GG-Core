/**
 * renderVetoPage : the HTML pages of a match veto (captains, and admins). Each phase says what happens now, shows the
 * buttons only to who may press them, and an admin sees every button named after the team it acts for. The tests read
 * the page text and the forms, not the whole markup, so a change of style does not break them.
 */
import { renderVetoPage, type VetoPageOptions } from './veto-view';
import type { VetoView } from './veto.service';

const HOME = { id: 'h', name: 'Démo Rouge', captain: 'Garitos' };
const AWAY = { id: 'a', name: 'Démo Bleue', captain: null };

function view(over: Partial<VetoView> = {}): VetoView {
  return {
    matchId: 'm-1',
    tournament: { id: 't-1', name: 'GG-Lan' },
    format: 'BO3',
    phase: 'veto',
    teams: { home: HOME, away: AWAY },
    config: { mapPool: ['de_mirage', 'de_inferno', 'de_nuke'], sideMode: 'knife' },
    rps: { rounds: [], current: null, winnerTeamId: null },
    startTeamId: 'h',
    steps: [],
    remaining: ['de_mirage', 'de_inferno', 'de_nuke'],
    next: { kind: 'ban', teamId: 'h' },
    maps: [],
    waitingFor: ['h'],
    lastActionAt: null,
    seq: 3,
    viewer: { teamId: null, admin: false, canAct: false },
    ...over,
  };
}

const captainOpts: VetoPageOptions = { mode: 'captain', loggedIn: true };
const adminOpts: VetoPageOptions = { mode: 'admin', loggedIn: true, isAdmin: true };
const asHome = { teamId: 'h', admin: false, canAct: true };

/** The text of the one big "what happens now" line. */
function turn(html: string): string | null {
  return /<p class="gg-turn(?: gg-you)?">([^<]*)<\/p>/.exec(html)?.[1] ?? null;
}
/** The labels of the buttons, in order. */
function buttons(html: string): string[] {
  return [...html.matchAll(/<button[^>]*>([^<]*)<\/button>/g)].map((m) => m[1]);
}
/** The actions the forms post to. */
function actions(html: string): string[] {
  return [...html.matchAll(/<form method="post" action="([^"]*)"/g)].map((m) => m[1]);
}

describe('renderVetoPage : the header', () => {
  it('titles the page with the two teams, and tells apart the captain page and the admin page', () => {
    expect(renderVetoPage(view(), captainOpts)).toContain('<h1>Véto : Démo Rouge contre Démo Bleue</h1>');
    expect(renderVetoPage(view(), adminOpts)).toContain('<h1>Véto, page admin : Démo Rouge contre Démo Bleue</h1>');
  });

  it('names the tournament, the format, how the sides are decided and the captains', () => {
    const html = renderVetoPage(view({ config: { mapPool: [], sideMode: 'pick' } }), captainOpts);

    expect(html).toContain('GG-Lan, BO3, sides choisis au véto, knife sur le decider.');
    expect(html).toContain('Capitaines : Garitos pour Démo Rouge, non désigné pour Démo Bleue.');
    expect(renderVetoPage(view(), captainOpts)).toContain('knife sur chaque map');
  });

  it('leaves the side rule out when the veto has no config', () => {
    expect(renderVetoPage(view({ config: null }), captainOpts)).toContain('GG-Lan, BO3.<br>');
  });

  it('links to the match, and to the other veto page only for an admin', () => {
    expect(renderVetoPage(view(), captainOpts)).toContain('<a href="/view/matches/m-1">Page du match</a>');
    expect(renderVetoPage(view(), captainOpts)).not.toContain('/veto/m-1/admin');
    expect(renderVetoPage(view(), { ...captainOpts, isAdmin: true })).toContain('<a href="/veto/m-1/admin">page admin de ce véto</a>');
    expect(renderVetoPage(view(), adminOpts)).toContain('<a href="/veto/m-1">page des capitaines</a>');
  });

  it('shows an error, escaped', () => {
    const html = renderVetoPage(view(), { ...captainOpts, error: 'Map <b>inconnue</b>' });

    expect(html).toContain('<mark>Map &lt;b&gt;inconnue&lt;/b&gt;</mark>');
  });

  it('escapes what a team is called', () => {
    const html = renderVetoPage(view({ teams: { home: { ...HOME, name: '<script>x</script>' }, away: AWAY } }), captainOpts);

    expect(html).not.toContain('<script>x</script>');
    expect(html).toContain('&lt;script&gt;x&lt;/script&gt; contre Démo Bleue');
  });

  it('asks a visitor who is not logged in to sign in with Steam, and sends him back to the page he was on', () => {
    expect(renderVetoPage(view(), { mode: 'captain', loggedIn: false })).toContain('<a href="/login?next=%2Fveto%2Fm-1">Connecte-toi avec Steam</a>');
    expect(renderVetoPage(view(), { mode: 'admin', loggedIn: false })).not.toContain('Connecte-toi');
  });

  it('does not ask a signed in visitor, nor a captain, to sign in', () => {
    expect(renderVetoPage(view(), captainOpts)).not.toContain('Connecte-toi');
    expect(renderVetoPage(view({ viewer: asHome }), { mode: 'captain', loggedIn: false })).not.toContain('Connecte-toi');
  });

  it('tells an admin that every button acts for the team it names', () => {
    expect(renderVetoPage(view(), adminOpts)).toContain('à la place de l’équipe qu’il nomme');
    expect(renderVetoPage(view(), captainOpts)).not.toContain('à la place de l’équipe');
  });
});

describe('renderVetoPage : a veto that cannot happen', () => {
  it.each([
    ['both teams must be known', 'les deux équipes ne sont pas encore connues'],
    ['no map pool configured for this tournament / stage', 'aucun map pool configuré'],
    ['the games of this match were set without a veto', 'fixées sans véto'],
    ['match finished', 'le match est terminé'],
  ])('explains "%s" in French', (reason, expected) => {
    const html = renderVetoPage(view({ phase: 'unavailable', reason, next: null }), captainOpts);

    expect(turn(html)).toContain(expected);
    expect(buttons(html)).toEqual([]);
  });

  it('gives a reason it does not know as it is', () => {
    expect(turn(renderVetoPage(view({ phase: 'unavailable', reason: 'something new', next: null }), captainOpts))).toBe('Véto indisponible : something new');
  });

  it('offers an admin no correction on a veto that is unavailable', () => {
    const html = renderVetoPage(view({ phase: 'unavailable', reason: 'match finished', next: null, startTeamId: null }), adminOpts);

    expect(html).not.toContain('Corrections');
    expect(html).not.toContain('Pierre-feuille-ciseaux joué ailleurs');
  });

  it('offers an admin the reset, and only the reset, on a veto whose state is inconsistent', () => {
    const html = renderVetoPage(view({ phase: 'unavailable', reason: 'veto inconsistent: step 3', next: null }), adminOpts);

    expect(html).toContain('Corrections');
    expect(buttons(html)).toEqual(['Recommencer le véto']);
  });
});

describe('renderVetoPage : rock, paper, scissors', () => {
  const rps = (over: Partial<VetoView['rps']> = {}): VetoView['rps'] => ({
    rounds: [],
    current: { round: 1, homePlayed: false, awayPlayed: false },
    winnerTeamId: null,
    ...over,
  });

  it('asks the captain whose turn it is to play, with the three choices', () => {
    const html = renderVetoPage(view({ phase: 'rps', next: null, startTeamId: null, rps: rps(), waitingFor: ['h', 'a'], viewer: asHome }), captainOpts);

    expect(turn(html)).toBe('Démo Rouge : pierre, feuille ou ciseaux ?');
    expect(html).toContain('class="gg-turn gg-you"');
    expect(buttons(html)).toEqual(['Pierre', 'Feuille', 'Ciseaux']);
    expect(actions(html)).toEqual(['/veto/m-1/rps', '/veto/m-1/rps', '/veto/m-1/rps']);
    expect(html).toContain('name="choice" value="rock"');
  });

  it('tells a captain what he played and who is still to choose, without buttons', () => {
    const current = { round: 1, homePlayed: true, awayPlayed: false, mine: 'paper' as const };
    const html = renderVetoPage(view({ phase: 'rps', next: null, startTeamId: null, rps: rps({ current }), waitingFor: ['a'], viewer: { teamId: 'h', admin: false, canAct: false } }), captainOpts);

    expect(turn(html)).toBe('Tu as joué feuille. Démo Bleue n’a pas encore choisi.');
    expect(buttons(html)).toEqual([]);
  });

  it('shows a spectator who is awaited, and the round after a tie', () => {
    const first = renderVetoPage(view({ phase: 'rps', next: null, startTeamId: null, rps: rps(), waitingFor: ['h', 'a'] }), captainOpts);
    const second = renderVetoPage(view({ phase: 'rps', next: null, startTeamId: null, rps: rps({ current: { round: 2, homePlayed: false, awayPlayed: false } }), waitingFor: ['h', 'a'] }), captainOpts);

    expect(turn(first)).toBe('Pierre-feuille-ciseaux : on attend Démo Rouge et Démo Bleue.');
    expect(turn(second)).toBe('Pierre-feuille-ciseaux, manche 2 : on attend Démo Rouge et Démo Bleue.');
  });

  it('never shows the buttons to an admin on the admin page', () => {
    const html = renderVetoPage(view({ phase: 'rps', next: null, startTeamId: null, rps: rps(), waitingFor: ['h', 'a'], viewer: { teamId: null, admin: true, canAct: true } }), adminOpts);

    expect(buttons(html).filter((b) => ['Pierre', 'Feuille', 'Ciseaux'].includes(b))).toEqual([]);
  });

  it('lets the winner choose who starts, naming the other team', () => {
    const html = renderVetoPage(view({ phase: 'rps_decision', next: null, startTeamId: null, rps: rps({ current: null, winnerTeamId: 'h' }), viewer: asHome }), captainOpts);

    expect(turn(html)).toBe('Tu as gagné le pierre-feuille-ciseaux : qui commence le véto ?');
    expect(buttons(html)).toEqual(['Je commence', 'Démo Bleue commence']);
    expect(html).toContain('name="first" value="true"');
    expect(html).toContain('name="first" value="false"');
  });

  it('tells the others who won and that he chooses', () => {
    const html = renderVetoPage(view({ phase: 'rps_decision', next: null, startTeamId: null, rps: rps({ current: null, winnerTeamId: 'a' }) }), captainOpts);

    expect(turn(html)).toBe('Démo Bleue a gagné le pierre-feuille-ciseaux et choisit qui commence.');
    expect(buttons(html)).toEqual([]);
  });

  it('recaps the rounds played and who started', () => {
    const rounds = [{ round: 1, home: 'rock' as const, away: 'rock' as const }, { round: 2, home: 'paper' as const, away: 'rock' as const }];
    const html = renderVetoPage(view({ rps: rps({ rounds, current: null, winnerTeamId: 'h' }), startTeamId: 'a' }), captainOpts);

    expect(html).toContain('manche 1, pierre contre pierre ; manche 2, feuille contre pierre.');
    expect(html).toContain('Démo Bleue a commencé le véto.');
  });

  it('says when an admin named the team that starts, and the veto had no rock, paper, scissors', () => {
    expect(renderVetoPage(view({ startTeamId: 'h' }), captainOpts)).toContain('Démo Rouge a commencé le véto (désigné par un admin).');
  });
});

describe('renderVetoPage : the veto itself', () => {
  it.each([
    ['ban', 'À toi de bannir une map.', 'Démo Rouge doit bannir une map.'],
    ['pick', 'À toi de choisir une map.', 'Démo Rouge doit choisir une map.'],
  ] as const)('a %s: the captain is told it is his turn and gets one button per map left', (kind, you, others) => {
    const mine = renderVetoPage(view({ next: { kind, teamId: 'h' }, viewer: asHome }), captainOpts);
    const theirs = renderVetoPage(view({ next: { kind, teamId: 'h' } }), captainOpts);

    expect(turn(mine)).toBe(you);
    expect(buttons(mine)).toEqual(['de_mirage', 'de_inferno', 'de_nuke']);
    expect(actions(mine)[0]).toBe('/veto/m-1/step');
    expect(turn(theirs)).toBe(others);
    expect(buttons(theirs)).toEqual([]);
  });

  it('a side: the captain chooses CT or T on the map, and sees it as "ton side"', () => {
    const html = renderVetoPage(view({ next: { kind: 'side', teamId: 'h', map: 'de_nuke' }, viewer: asHome }), captainOpts);

    expect(turn(html)).toBe('À toi de choisir ton side sur de_nuke.');
    expect(buttons(html)).toEqual(['CT', 'T']);
    expect(html).toContain('name="side" value="CT"');
  });

  it('an admin sees every button named after the team it acts for, whoever is to play', () => {
    const html = renderVetoPage(view({ next: { kind: 'ban', teamId: 'a' } }), adminOpts);

    expect(buttons(html).slice(0, 3)).toEqual(['Démo Bleue : de_mirage', 'Démo Bleue : de_inferno', 'Démo Bleue : de_nuke']);
    expect(html).toContain('<input type="hidden" name="_page" value="admin">');
  });

  it('a captain page does not carry the admin page marker', () => {
    expect(renderVetoPage(view({ viewer: asHome }), captainOpts)).not.toContain('name="_page"');
  });

  it('lets an admin who has not got the start pick the team that starts, and no one else', () => {
    const none = renderVetoPage(view({ phase: 'rps', next: null, startTeamId: null, rps: { rounds: [], current: { round: 1, homePlayed: false, awayPlayed: false }, winnerTeamId: null }, waitingFor: ['h', 'a'] }), adminOpts);

    expect(none).toContain('Pierre-feuille-ciseaux joué ailleurs, ou gagnant absent');
    expect(buttons(none)).toEqual(expect.arrayContaining(['Démo Rouge commence', 'Démo Bleue commence']));
    expect(renderVetoPage(view({ phase: 'rps', next: null, startTeamId: null, waitingFor: ['h'], rps: { rounds: [], current: { round: 1, homePlayed: false, awayPlayed: false }, winnerTeamId: null } }), captainOpts)).not.toContain('joué ailleurs');
  });

  it('shows the pool with the banned maps struck out and the picked ones named after their team', () => {
    const steps: VetoView['steps'] = [
      { order: 1, teamId: 'h', kind: 'ban', map: 'de_mirage', actedBy: null, at: new Date(0) },
      { order: 2, teamId: 'a', kind: 'pick', map: 'de_inferno', actedBy: null, at: new Date(0) },
    ];
    const html = renderVetoPage(view({ steps }), captainOpts);

    expect(html).toContain('Maps : <del>de_mirage</del>, <strong>de_inferno</strong> (Démo Bleue), de_nuke');
  });

  it('lists the steps with who played them: a captain, an admin by his name, "admin" kept when the name starts with it', () => {
    const steps: VetoView['steps'] = [
      { order: 1, teamId: 'h', kind: 'ban', map: 'de_mirage', actedBy: '76561198000000001', at: new Date(0) },
      { order: 2, teamId: 'a', kind: 'pick', map: 'de_inferno', actedBy: 'admin:Lana', at: new Date(0) },
      { order: 3, teamId: 'a', kind: 'side', map: 'de_inferno', side: 'CT', actedBy: 'admin:admin-bob', at: new Date(0) },
    ];
    const html = renderVetoPage(view({ steps }), captainOpts);

    expect(html).toContain('<td>1</td><td>Démo Rouge</td><td>bannit</td><td>de_mirage</td>');
    expect(html).toContain('capitaine,');
    expect(html).toContain('<td>choisit</td>');
    expect(html).toContain('admin Lana,');
    expect(html).toContain('<td>prend le side</td><td>de_inferno <span class="gg-ct">CT</span></td>');
    expect(html).toContain('admin-bob,');
    expect(html).not.toContain('admin admin-bob');
  });

  it('shows no steps table before the first step', () => {
    expect(renderVetoPage(view(), captainOpts)).not.toContain('Déroulé');
  });
});

describe('renderVetoPage : the result', () => {
  const maps: VetoView['maps'] = [
    { order: 1, map: 'de_mirage', pickedByTeamId: 'h', side: { teamId: 'a', side: 'T' } },
    { order: 2, map: 'de_inferno', pickedByTeamId: 'a', side: null },
    { order: 3, map: 'de_nuke', pickedByTeamId: null, side: { teamId: 'h', side: 'CT' } },
  ];
  const done = (over: Partial<VetoView> = {}) => view({ phase: 'done', next: null, remaining: [], maps, ...over });

  it('lists the maps played in order', () => {
    const html = renderVetoPage(done(), captainOpts);

    expect(turn(html)).toBe('Véto terminé : de_mirage, de_inferno, de_nuke.');
    expect(html).toContain('Maps du match');
    expect(html).toContain('<td>1</td><td><strong>de_mirage</strong></td><td>Démo Rouge</td><td>Démo Bleue en <span class="gg-t">T</span></td>');
  });

  it('says "knife" for a side nobody chose, and "decider" for the map nobody picked', () => {
    const html = renderVetoPage(done(), captainOpts);

    expect(html).toContain('<td><strong>de_inferno</strong></td><td>Démo Bleue</td><td>knife</td>');
    expect(html).toContain('<td><strong>de_nuke</strong></td><td>decider</td><td>Démo Rouge en <span class="gg-ct">CT</span></td>');
  });

  it('shows the advantage map as not played, counted as won, and leaves it out of the maps played', () => {
    const withAdvantage: VetoView['maps'] = [...maps.slice(0, 2), { order: 3, map: 'de_ancient', pickedByTeamId: null, side: null, advantageTeamId: 'h' }];
    const html = renderVetoPage(done({ maps: withAdvantage }), captainOpts);

    expect(html).toContain('<del>de_ancient</del>');
    expect(html).toContain('Map d’avance de Démo Rouge, non jouée, comptée gagnée');
    expect(turn(html)).toBe('Véto terminé : de_mirage, de_inferno.');
  });

  it('shows no pool and no buttons once it is done, but keeps the steps', () => {
    const steps: VetoView['steps'] = [{ order: 1, teamId: 'h', kind: 'ban', map: 'de_ancient', actedBy: null, at: new Date(0) }];
    const html = renderVetoPage(done({ steps }), captainOpts);

    expect(html).not.toContain('Maps : ');
    expect(buttons(html)).toEqual([]);
    expect(html).toContain('Déroulé');
  });

  it('offers an admin to undo or restart a finished veto', () => {
    const html = renderVetoPage(done(), adminOpts);

    expect(buttons(html)).toEqual(['Annuler la dernière action', 'Recommencer le véto']);
    expect(actions(html)).toEqual(['/veto/m-1/undo', '/veto/m-1/reset']);
    expect(html).toContain('Recommencer efface tout le véto');
  });
});

describe('renderVetoPage : staying up to date', () => {
  it('carries the version of the state and the match to the script that reloads the page', () => {
    const html = renderVetoPage(view({ seq: 9, matchId: 'm-"1' }), captainOpts);

    expect(html).toContain('const seq = 9;');
    expect(html).toContain('query: { matchId: "m-\\"1" }');
    expect(html).toContain("socket.on('veto:updated'");
  });

  it('is a full page, in the theme of its audience', () => {
    const page = renderVetoPage(view(), captainOpts);

    expect(page.startsWith('<!doctype html>')).toBe(true);
    expect(page).toContain('<title>Véto - Démo Rouge contre Démo Bleue</title>');
  });
});
