// src/application/tournament/veto-view.ts
// Pages of a match veto - test tools until the real veto screens: plain HTML forms, plus the one script of these
// pages: it follows the match room on the WebSocket and reloads the page on each veto update (`veto:updated`) it
// does not show yet, so nobody has to press F5.
// - /veto/:matchId        captains (and spectators): only the viewer's own moves, even if the viewer is an admin;
// - /veto/:matchId/admin  admins: who starts, playing a step for a team, undo, reset - every button names the team.
// Layout: the title, then ONE large line saying what happens now (.gg-turn, red when the viewer has to act), the
// buttons for it right below, then the history.
import { escapeHtml as esc, htmlPage } from '@app/shared/html-page';
import type { VetoView } from './veto.service';

const RPS_FR: Record<string, string> = { rock: 'pierre', paper: 'feuille', scissors: 'ciseaux' };
const RPS_BUTTON: Record<string, string> = { rock: 'Pierre', paper: 'Feuille', scissors: 'Ciseaux' };
const KIND_FR: Record<string, string> = { ban: 'bannit', pick: 'choisit', side: 'prend le side' };
const REASON_FR: Record<string, string> = {
  'both teams must be known': 'Véto indisponible : les deux équipes ne sont pas encore connues.',
  'no map pool configured for this tournament / stage': 'Véto indisponible : aucun map pool configuré pour ce tournoi ou cette phase.',
  'the games of this match were set without a veto': 'Pas de véto : les maps de ce match ont été fixées sans véto.',
  'match finished': 'Pas de véto : le match est terminé.',
};

/** "admin:<name>" → the admin's name (marked as admin), a SteamID → the captain. */
const author = (actedBy: string | null) => {
  if (!actedBy?.startsWith('admin:')) return 'capitaine';
  const n = actedBy.slice(6);
  return n.toLowerCase().startsWith('admin') ? n : `admin ${n}`;
};

export interface VetoPageOptions {
  mode: 'captain' | 'admin';
  error?: string;
  loggedIn: boolean;
  /** captain page: link to the admin page for an admin */
  isAdmin?: boolean;
}

/**
 * `v` must be read with the right viewer: on the captain page an admin is read as a plain player (its `canAct`
 * then only means its own turn as a captain).
 */
export function renderVetoPage(v: VetoView, opts: VetoPageOptions): string {
  const admin = opts.mode === 'admin';
  const base = `/veto/${v.matchId}`;
  const here = admin ? `${base}/admin` : base;
  const name = (teamId: string | null | undefined) =>
    teamId === v.teams.home.id ? v.teams.home.name : teamId === v.teams.away.id ? v.teams.away.name : '?';
  const side = (s: string) => `<span class="${s === 'CT' ? 'gg-ct' : 'gg-t'}">${s}</span>`;
  // the actions are the same routes for both pages; `_page` brings the browser back to the page it came from
  const form = (action: string, fields: Record<string, string>, label: string, cls = '') =>
    `<form method="post" action="${base}/${action}"><input type="hidden" name="_form" value="1">` +
    (admin ? '<input type="hidden" name="_page" value="admin">' : '') +
    Object.entries(fields).map(([k, val]) => `<input type="hidden" name="${k}" value="${esc(val)}">`).join('') +
    `<button${cls ? ` class="${cls}"` : ''}>${esc(label)}</button></form>`;
  const buttons = (items: string[]) => `<div class="gg-actions">${items.join('')}</div>`;
  const turn = (text: string, you: boolean) => `<p class="gg-turn${you ? ' gg-you' : ''}">${esc(text)}</p>`;

  const parts: string[] = [];
  const title = `${v.teams.home.name} contre ${v.teams.away.name}`;
  parts.push(`<h1>${admin ? 'Véto, page admin : ' : 'Véto : '}${esc(title)}</h1>`);
  const sideMode = v.config ? (v.config.sideMode === 'pick' ? 'sides choisis au véto, knife sur le decider' : 'knife sur chaque map') : '';
  parts.push(`<p class="gg-meta">${esc(v.tournament.name)}, ${v.format}${sideMode ? `, ${sideMode}` : ''}.<br>` +
    `Capitaines : ${esc(v.teams.home.captain ?? 'non désigné')} pour ${esc(v.teams.home.name)}, ` +
    `${esc(v.teams.away.captain ?? 'non désigné')} pour ${esc(v.teams.away.name)}.<br>` +
    `<a href="/view/matches/${v.matchId}">Page du match</a>` +
    (admin ? `, <a href="${base}">page des capitaines</a>` : opts.isAdmin ? `, <a href="${base}/admin">page admin de ce véto</a>` : '') +
    '</p>');
  if (opts.error) parts.push(`<p><mark>${esc(opts.error)}</mark></p>`);
  if (admin) parts.push('<p>Chaque bouton agit à la place de l’équipe qu’il nomme, pour débloquer un capitaine absent.</p>');
  else if (!v.viewer.teamId && !opts.loggedIn) {
    parts.push(`<p><a href="/login?next=${encodeURIComponent(here)}">Connecte-toi avec Steam</a> si tu es capitaine.</p>`);
  }

  // --- What happens now, and its buttons ----------------------------------------------------------------
  const you = !admin && v.viewer.canAct;
  const mine = v.viewer.teamId;
  if (v.phase === 'unavailable') {
    parts.push(turn(REASON_FR[v.reason ?? ''] ?? `Véto indisponible : ${v.reason ?? ''}`, false));
  } else if (v.phase === 'rps') {
    const c = v.rps.current!;
    const waiting = v.waitingFor.map(name).join(' et ');
    if (you) parts.push(turn(`${name(mine)} : pierre, feuille ou ciseaux ?`, true));
    else if (c.mine) parts.push(turn(`Tu as joué ${RPS_FR[c.mine]}. ${waiting} n’a pas encore choisi.`, false));
    else parts.push(turn(`Pierre-feuille-ciseaux${c.round > 1 ? `, manche ${c.round}` : ''} : on attend ${waiting}.`, false));
    if (you) parts.push(buttons(['rock', 'paper', 'scissors'].map((ch) => form('rps', { choice: ch }, RPS_BUTTON[ch]))));
  } else if (v.phase === 'rps_decision') {
    const winner = name(v.rps.winnerTeamId);
    const loser = v.rps.winnerTeamId === v.teams.home.id ? v.teams.away.name : v.teams.home.name;
    parts.push(turn(you ? 'Tu as gagné le pierre-feuille-ciseaux : qui commence le véto ?' : `${winner} a gagné le pierre-feuille-ciseaux et choisit qui commence.`, you));
    if (you) parts.push(buttons([form('start', { first: 'true' }, 'Je commence'), form('start', { first: 'false' }, `${loser} commence`, 'secondary')]));
  } else if (v.phase === 'veto' && v.next) {
    const who = name(v.next.teamId);
    const what = { ban: 'bannir une map', pick: 'choisir une map', side: `choisir son side sur ${v.next.map}` }[v.next.kind];
    parts.push(turn(you ? `À toi de ${what.replace('son side', 'ton side')}.` : `${who} doit ${what}.`, you));
    if (you || admin) {
      const label = (text: string) => (admin ? `${who} : ${text}` : text);
      parts.push(
        v.next.kind === 'side'
          ? buttons(['CT', 'T'].map((s) => form('step', { side: s }, label(s), s === 'CT' ? 'gg-ct' : 'gg-t')))
          : buttons(v.remaining.map((map) => form('step', { map }, label(map)))),
      );
    }
  } else if (v.phase === 'done') {
    const played = v.maps.filter((m) => !m.advantageTeamId).map((m) => m.map);
    parts.push(turn(`Véto terminé : ${played.join(', ')}.`, false));
  }

  // Admin: who starts, when the RPS was played elsewhere or the winner is away
  if (admin && v.phase !== 'unavailable' && !v.startTeamId) {
    parts.push('<p>Pierre-feuille-ciseaux joué ailleurs, ou gagnant absent : choisis l’équipe qui commence.</p>');
    parts.push(buttons([v.teams.home, v.teams.away].map((t) => form('start', { teamId: t.id }, `${t.name} commence`, 'secondary'))));
  }

  // --- Result -------------------------------------------------------------------------------------------
  if (v.phase === 'done') {
    parts.push('<h2>Maps du match</h2>');
    const rows = v.maps.map((m) => {
      if (m.advantageTeamId) {
        return `<tr><td></td><td><del>${esc(m.map)}</del></td><td colspan="2">Map d’avance de ${esc(name(m.advantageTeamId))}, non jouée, comptée gagnée</td></tr>`;
      }
      const start = m.side ? `${esc(name(m.side.teamId))} en ${side(m.side.side)}` : 'knife';
      return `<tr><td>${m.order}</td><td><strong>${esc(m.map)}</strong></td><td>${m.pickedByTeamId ? esc(name(m.pickedByTeamId)) : 'decider'}</td><td>${start}</td></tr>`;
    });
    parts.push(`<table><thead><tr><th>Game</th><th>Map</th><th>Choisie par</th><th>Side de départ</th></tr></thead><tbody>${rows.join('')}</tbody></table>`);
    parts.push('<p class="gg-meta">Un admin attribue le serveur au lancement de chaque game.</p>');
  }

  // --- History ------------------------------------------------------------------------------------------
  if (v.phase === 'veto' && v.config) {
    const banned = new Set(v.steps.filter((s) => s.kind === 'ban').map((s) => s.map));
    const picked = new Map(v.steps.filter((s) => s.kind === 'pick').map((s) => [s.map, s.teamId]));
    const pool = v.config.mapPool.map((m) =>
      banned.has(m) ? `<del>${esc(m)}</del>` : picked.has(m) ? `<strong>${esc(m)}</strong> (${esc(name(picked.get(m)))})` : esc(m),
    );
    parts.push(`<p>Maps : ${pool.join(', ')}</p>`);
  }
  if ((v.phase === 'veto' || v.phase === 'done') && v.steps.length) {
    parts.push('<h2>Déroulé</h2>');
    const rows = v.steps.map(
      (s) =>
        `<tr><td>${s.order}</td><td>${esc(name(s.teamId))}</td><td>${KIND_FR[s.kind]}</td><td>${esc(s.map)}${s.side ? ` ${side(s.side)}` : ''}</td>` +
        `<td class="gg-meta">${esc(author(s.actedBy))}, ${s.at.toLocaleTimeString('fr-FR')}</td></tr>`,
    );
    parts.push(`<table><thead><tr><th>Étape</th><th>Équipe</th><th>Action</th><th>Map</th><th>Par</th></tr></thead><tbody>${rows.join('')}</tbody></table>`);
  }
  if (v.phase !== 'unavailable' && v.rps.rounds.length) {
    const rounds = v.rps.rounds.map((r) => `manche ${r.round}, ${RPS_FR[r.home]} contre ${RPS_FR[r.away]}`);
    parts.push(`<p class="gg-meta">Pierre-feuille-ciseaux (${esc(v.teams.home.name)} contre ${esc(v.teams.away.name)}) : ${rounds.join(' ; ')}.` +
      (v.startTeamId ? ` ${esc(name(v.startTeamId))} a commencé le véto.` : '') + '</p>');
  } else if (v.startTeamId) {
    parts.push(`<p class="gg-meta">${esc(name(v.startTeamId))} a commencé le véto (désigné par un admin).</p>`);
  }

  // --- Admin corrections --------------------------------------------------------------------------------
  if (admin && (v.phase !== 'unavailable' || v.reason?.startsWith('veto inconsistent'))) {
    parts.push('<h2>Corrections</h2>');
    if (v.phase !== 'unavailable') parts.push(buttons([form('undo', {}, 'Annuler la dernière action', 'secondary')]));
    parts.push('<p class="gg-meta">Recommencer efface tout le véto, pierre-feuille-ciseaux compris.</p>');
    parts.push(buttons([form('reset', {}, 'Recommencer le véto', 'danger')]));
  }

  // Live: reload on an update this page does not show yet (its own action already came back through the redirect)
  parts.push(`<script src="/socket.io/socket.io.js"></script>
<script>
const seq = ${v.seq};
const socket = io({ query: { matchId: ${JSON.stringify(v.matchId)} }, transports: ['websocket'] });
socket.on('veto:updated', (e) => { if (e.seq !== seq) location.reload(); });
// an update sent between this page and the connection: compare with the current state
socket.on('connect', () => fetch('/api/tournament/matches/${v.matchId}/veto').then((r) => r.json()).then((s) => { if (s.seq !== seq) location.reload(); }).catch(() => {}));
</script>`);
  return htmlPage({ title: `Véto - ${title}`, body: parts.join('\n'), theme: admin ? 'admin' : 'public' });
}
