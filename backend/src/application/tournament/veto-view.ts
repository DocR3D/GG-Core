// src/application/tournament/veto-view.ts
// Pages of a match veto - test tools until the real veto screens: plain HTML forms, plus the one script of these
// pages: it follows the match room on the WebSocket and reloads the page on each veto update (`veto:updated`) it
// does not show yet, so nobody has to press F5.
// - /veto/:matchId        captains (and spectators): only the viewer's own moves, even if the viewer is an admin;
// - /veto/:matchId/admin  admins: who starts, playing a step for a team, undo, reset - every button names the team.
import { escapeHtml as esc, htmlPage } from '@app/shared/html-page';
import type { VetoView } from './veto.service';

const RPS_FR: Record<string, string> = { rock: 'pierre', paper: 'feuille', scissors: 'ciseaux' };
const KIND_FR: Record<string, string> = { ban: 'bannit', pick: 'choisit', side: 'prend le side' };
const NEXT_FR: Record<string, string> = { ban: 'bannir une map', pick: 'choisir une map', side: 'choisir son side' };
const REASON_FR: Record<string, string> = {
  'both teams must be known': 'les deux équipes ne sont pas encore connues.',
  'no map pool configured for this tournament / stage': 'aucun map pool configuré pour ce tournoi ou cette phase.',
  'the games of this match were set without a veto': 'les games de ce match ont été fixés sans véto.',
  'match finished': 'le match est terminé.',
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
  // the actions are the same routes for both pages; `_page` brings the browser back to the page it came from
  const form = (action: string, fields: Record<string, string>, label: string, secondary = false) =>
    `<form method="post" action="${base}/${action}"><input type="hidden" name="_form" value="1">` +
    (admin ? '<input type="hidden" name="_page" value="admin">' : '') +
    Object.entries(fields).map(([k, val]) => `<input type="hidden" name="${k}" value="${esc(val)}">`).join('') +
    `<button${secondary ? ' class="secondary"' : ''}>${esc(label)}</button></form>`;
  const buttons = (items: string[]) => `<div class="gg-actions">${items.join('')}</div>`;

  const parts: string[] = [];
  const title = `${admin ? 'Admin véto' : 'Véto'} - ${v.teams.home.name} vs ${v.teams.away.name}`;
  parts.push(`<h1>${esc(title)}</h1>`);
  parts.push(
    `<p>${esc(v.tournament.name)} · ${v.format} · <a href="/view/matches/${v.matchId}">page du match</a> · ` +
      (admin ? `<a href="${base}">page des capitaines</a>` : opts.isAdmin ? `<a href="${base}/admin">page admin de ce véto</a>` : '') +
      (v.config ? ` · sides : ${v.config.sideMode === 'pick' ? 'choisis au véto (knife sur le decider)' : 'knife sur chaque map'}` : '') +
      '</p>',
  );
  parts.push(
    `<p>Capitaines : ${esc(v.teams.home.captain ?? '(non désigné)')} (${esc(v.teams.home.name)}), ` +
      `${esc(v.teams.away.captain ?? '(non désigné)')} (${esc(v.teams.away.name)})</p>`,
  );
  if (opts.error) parts.push(`<p><mark>${esc(opts.error)}</mark></p>`);
  if (admin) {
    parts.push('<p>Page admin : chaque bouton agit <strong>à la place de l’équipe nommée</strong>, pour débloquer un capitaine absent.</p>');
  } else if (v.viewer.teamId) {
    parts.push(`<p>Tu es capitaine de <strong>${esc(name(v.viewer.teamId))}</strong>.</p>`);
  } else if (!opts.loggedIn) {
    parts.push(`<p><a href="/login?next=${encodeURIComponent(here)}">Connecte-toi avec Steam</a> si tu es capitaine.</p>`);
  }

  if (v.phase === 'unavailable') {
    parts.push(`<p>Véto indisponible : ${esc(REASON_FR[v.reason ?? ''] ?? v.reason ?? '')}</p>`);
  }

  // Rock-paper-scissors
  if (v.phase !== 'unavailable') {
    parts.push('<h2>Pierre-feuille-ciseaux</h2>');
    for (const r of v.rps.rounds) {
      parts.push(`<p>Manche ${r.round} : ${esc(v.teams.home.name)} ${RPS_FR[r.home]}, ${esc(v.teams.away.name)} ${RPS_FR[r.away]}${r === v.rps.rounds[v.rps.rounds.length - 1] && v.rps.winnerTeamId ? '' : ' (égalité)'}</p>`);
    }
    const c = v.rps.current;
    if (v.phase === 'rps' && c) {
      const st = (played: boolean) => (played ? 'a choisi' : 'n’a pas encore choisi');
      parts.push(`<p>Manche ${c.round} : ${esc(v.teams.home.name)} ${st(c.homePlayed)}, ${esc(v.teams.away.name)} ${st(c.awayPlayed)}.</p>`);
      if (!admin && c.mine) parts.push(`<p>Ton choix : ${RPS_FR[c.mine]}. En attente de l’adversaire.</p>`);
      else if (!admin && v.viewer.canAct) parts.push(buttons(['rock', 'paper', 'scissors'].map((ch) => form('rps', { choice: ch }, RPS_FR[ch]))));
    }
    if (v.rps.winnerTeamId) parts.push(`<p><strong>${esc(name(v.rps.winnerTeamId))}</strong> gagne le pierre-feuille-ciseaux.</p>`);
    if (v.startTeamId) parts.push(`<p>${esc(name(v.startTeamId))} commence le véto.</p>`);
    if (!admin && v.phase === 'rps_decision' && v.viewer.canAct) {
      const loser = v.rps.winnerTeamId === v.teams.home.id ? v.teams.away.name : v.teams.home.name;
      parts.push(buttons([form('start', { first: 'true' }, 'Commencer le véto'), form('start', { first: 'false' }, `Laisser commencer ${loser}`, true)]));
    }
    if (admin && !v.startTeamId) {
      parts.push('<p>Pierre-feuille-ciseaux joué ailleurs, ou gagnant absent : quelle équipe commence le véto ?</p>');
      parts.push(buttons([v.teams.home, v.teams.away].map((t) => form('start', { teamId: t.id }, `${t.name} commence`, true))));
    }
  }

  // Veto steps
  if (v.phase === 'veto' || v.phase === 'done') {
    parts.push('<h2>Véto</h2>');
    if (v.steps.length) {
      const rows = v.steps.map(
        (s) =>
          `<tr><td>${s.order}</td><td>${esc(name(s.teamId))}</td><td>${KIND_FR[s.kind]}</td><td>${esc(s.map)}${s.side ? ` : ${s.side}` : ''}</td>` +
          `<td><small>${esc(author(s.actedBy))}, ${s.at.toLocaleTimeString('fr-FR')}</small></td></tr>`,
      );
      parts.push(`<table><thead><tr><th>#</th><th>Équipe</th><th>Action</th><th>Map</th><th>Par</th></tr></thead><tbody>${rows.join('')}</tbody></table>`);
    }
    if (v.next) {
      const who = name(v.next.teamId);
      parts.push(`<p>Au tour de <strong>${esc(who)}</strong> de ${NEXT_FR[v.next.kind]}${v.next.map ? ` sur ${esc(v.next.map)}` : ''}.</p>`);
      const mapLabel = (map: string) => (admin ? `${who} : ${v.next!.kind} ${map}` : map);
      if (admin || v.viewer.canAct) {
        if (admin) parts.push(`<p><small>À la place de ${esc(who)} :</small></p>`);
        parts.push(
          v.next.kind === 'side'
            ? buttons(['CT', 'T'].map((side) => form('step', { side }, admin ? `${who} en ${side}` : side, admin)))
            : buttons(v.remaining.map((map) => form('step', { map }, mapLabel(map), admin || v.next!.kind === 'ban'))),
        );
      }
    }
    if (v.phase === 'veto' && v.config) {
      const banned = new Set(v.steps.filter((s) => s.kind === 'ban').map((s) => s.map));
      const picked = new Set(v.steps.filter((s) => s.kind === 'pick').map((s) => s.map));
      const pool = v.config.mapPool.map((m) => (banned.has(m) ? `<del>${esc(m)}</del>` : picked.has(m) ? `<strong>${esc(m)}</strong>` : esc(m)));
      parts.push(`<p>Map pool : ${pool.join(' · ')}</p>`);
    }
  }

  // Result
  if (v.phase === 'done') {
    parts.push('<h2>Maps du match</h2>');
    const rows = v.maps.map((m) => {
      if (m.advantageTeamId) {
        return `<tr><td>-</td><td><del>${esc(m.map)}</del></td><td colspan="2">map d’avance de ${esc(name(m.advantageTeamId))} : non jouée, comptée gagnée</td></tr>`;
      }
      const side = m.side ? `${esc(name(m.side.teamId))} en ${m.side.side}` : 'knife';
      return `<tr><td>${m.order}</td><td><strong>${esc(m.map)}</strong></td><td>${m.pickedByTeamId ? esc(name(m.pickedByTeamId)) : 'decider'}</td><td>${side}</td></tr>`;
    });
    parts.push(`<table><thead><tr><th>Game</th><th>Map</th><th>Choisie par</th><th>Side de départ</th></tr></thead><tbody>${rows.join('')}</tbody></table>`);
    parts.push('<p>Le serveur sera attribué par un admin au lancement de chaque game.</p>');
  }

  if (admin && (v.phase !== 'unavailable' || v.reason?.startsWith('veto inconsistent'))) {
    parts.push('<h2>Corrections</h2>');
    parts.push(
      buttons([
        ...(v.phase !== 'unavailable' ? [form('undo', {}, 'Annuler la dernière action', true)] : []),
        form('reset', {}, 'Tout recommencer (pierre-feuille-ciseaux compris)', true),
      ]),
    );
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
  return htmlPage({ title, body: parts.join('\n'), theme: admin ? 'admin' : 'public' });
}
