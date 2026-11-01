import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { api, type OverviewMatch, type ServerRow, type TournamentTeam } from '../../lib/api';
import { Button, Field, Input, Select, type Action } from '../../components/ui';
import { isSettled, type VetoLine } from './model';

const STATUS: Record<string, string> = { PENDING: 'à jouer', LIVE: 'en cours', FINISHED: 'terminé', CANCELLED: 'annulé' };
type Panel = 'forfeit' | 'format' | 'replace' | 'result' | 'correct' | null;

/**
 * One match of the management screen: teams (or where they come from), score, state; launch of its next game; and
 * behind "Actions" the operations of the LAN day (forfeit, format, replace a team, result entered by hand, remove a
 * bonus match). Every refusal comes back with the API's reason (shown by the screen's notice line).
 */
export function MatchRow({
  match: m,
  servers,
  teams,
  action,
  bonus = false,
  veto = null,
  tag,
}: {
  match: OverviewMatch;
  servers: ServerRow[];
  teams: TournamentTeam[];
  action: Action;
  bonus?: boolean;
  /** where its veto stands (vetoLine) */
  veto?: VetoLine;
  /** shown where a bracket match has its label (e.g. the group) */
  tag?: string;
}) {
  const navigate = useNavigate();
  const [panel, setPanel] = useState<Panel>(null);
  const live = m.games.find((g) => g.status === 'LIVE');
  const next = m.games.find((g) => g.status === 'PENDING') ?? null;
  const order = next?.order ?? m.games.filter((g) => g.status !== 'CANCELLED').length + 1;
  const [map, setMap] = useState(next && next.mapName !== '-' ? next.mapName : '');
  const [server, setServer] = useState('');
  const known = !!m.homeId && !!m.awayId;
  // a cancelled match (groups closed early) is settled like a finished one: no action on it
  const finished = isSettled(m);
  const started = m.status !== 'PENDING' || m.games.some((g) => g.status !== 'PENDING');
  const playable = !finished && known && !live;
  const toggle = (p: Panel) => setPanel((cur) => (cur === p ? null : p));

  return (
    <li className="py-3">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        {(m.label ?? tag) && <span className="w-16 font-mono text-xs text-muted">{m.label ?? tag}</span>}
        <span className="min-w-64">
          <Team name={m.home} from={m.homeFrom} winner={finished && m.winner === m.home} />
          <span className="text-muted"> contre </span>
          <Team name={m.away} from={m.awayFrom} winner={finished && m.winner === m.away} />
        </span>
        <span className="font-mono text-sm text-muted">
          {m.format} {m.status !== 'PENDING' && `${m.scoreHome}-${m.scoreAway}`}
        </span>
        {!!m.advantageHome && <Advantage m={m} />}
        <span className={`text-sm ${m.status === 'LIVE' ? 'text-ok' : 'text-muted'}`}>{m.isForfeit ? 'forfait' : (STATUS[m.status] ?? m.status)}</span>
        {veto && (
          <a href={`/veto/${m.id}/admin`} className={`text-sm hover:text-white ${veto.tone}`} title="Ouvrir le véto (admin)">
            {veto.text}
          </a>
        )}
        <span className="ml-auto flex flex-wrap items-center gap-2">
          {live?.id && (
            <Link to={`/admin/games/${live.id}`} className="text-sm font-semibold text-white underline">
              Console du game {live.order}
            </Link>
          )}
          {playable && (
            <form
              className="flex flex-wrap items-center gap-2"
              onSubmit={async (e: FormEvent) => {
                e.preventDefault();
                const r = await action.run(`Game ${order} lancé`, () =>
                  api<{ gameId: string }>(`/api/tournament/matches/${m.id}/games/${order}/launch`, {
                    method: 'POST',
                    body: JSON.stringify({ mapName: map.trim() || undefined, server: server || undefined }),
                  }),
                );
                if (r?.gameId) navigate(`/admin/games/${r.gameId}`);
              }}
            >
              <Input value={map} onChange={(e) => setMap(e.target.value)} placeholder="de_mirage" className="w-32 font-mono text-sm" aria-label="Map" />
              <Select value={server} onChange={(e) => setServer(e.target.value)} aria-label="Serveur" className="text-sm">
                <option value="">serveur libre</option>
                {servers
                  .filter((s) => s.availability === 'free')
                  .map((s) => (
                    <option key={s.id} value={s.name}>
                      {s.name}
                    </option>
                  ))}
              </Select>
              <Button small primary type="submit" disabled={action.busy || (!map.trim() && !next)}>
                Lancer le game {order}
              </Button>
            </form>
          )}
          {!finished && known && (
            <>
              <Button small onClick={() => toggle('result')}>
                Saisir un résultat
              </Button>
              <Button small onClick={() => toggle('forfeit')}>
                Forfait
              </Button>
            </>
          )}
          {m.status === 'FINISHED' && m.games.some((g) => g.status === 'FINISHED') && (
            <Button small onClick={() => toggle('correct')}>
              Corriger le résultat
            </Button>
          )}
          {!started && (
            <>
              <Button small onClick={() => toggle('format')}>
                Format
              </Button>
              {known && (
                <Button small onClick={() => toggle('replace')}>
                  Remplacer une équipe
                </Button>
              )}
            </>
          )}
          {bonus && !started && (
            <Button
              small
              danger
              disabled={action.busy}
              onClick={() => action.run('Match bonus supprimé', () => api(`/api/tournament/bonus-matches/${m.id}`, { method: 'DELETE' }))}
            >
              Supprimer
            </Button>
          )}
        </span>
      </div>
      {panel === 'forfeit' && <ForfeitPanel m={m} action={action} onDone={() => setPanel(null)} />}
      {panel === 'format' && <FormatPanel m={m} action={action} onDone={() => setPanel(null)} />}
      {panel === 'replace' && <ReplacePanel m={m} teams={teams} action={action} onDone={() => setPanel(null)} />}
      {panel === 'result' && <ResultPanel m={m} order={order} defaultMap={map} action={action} onDone={() => setPanel(null)} />}
      {panel === 'correct' && <CorrectPanel m={m} action={action} onDone={() => setPanel(null)} />}
    </li>
  );
}

/** The grand final's map advantage, said in words (a BO3 won after one game looked like a bug). */
function Advantage({ m }: { m: OverviewMatch }) {
  const who = m.home ?? 'le vainqueur du haut';
  const n = m.advantageHome ?? 0;
  return (
    <span className="text-sm text-pause" title="Le vainqueur du bracket du haut n'a encore jamais perdu : il commence la finale avec une map d'avance.">
      {who} part avec {n} map{n > 1 ? 's' : ''} d'avance (compté dans le score)
    </span>
  );
}

function Team({ name, from, winner }: { name: string | null; from?: string | null; winner: boolean }) {
  if (!name) return <span className="text-muted">{from ?? 'à déterminer'}</span>;
  return <span className={winner ? 'font-semibold text-white' : 'text-white'}>{name}</span>;
}

const panelClass = 'mt-3 flex flex-wrap items-end gap-2 border-l-2 border-line-strong pl-4';

function ForfeitPanel({ m, action, onDone }: { m: OverviewMatch; action: Action; onDone: () => void }) {
  const [absent, setAbsent] = useState('');
  return (
    <form
      className={panelClass}
      onSubmit={async (e: FormEvent) => {
        e.preventDefault();
        const name = absent === m.homeId ? m.home : m.away;
        if (
          await action.run(`Forfait de ${name}`, () =>
            api(`/api/tournament/matches/${m.id}/forfeit`, { method: 'POST', body: JSON.stringify({ absentTeamId: absent }) }),
          )
        )
          onDone();
      }}
    >
      <Field label="Équipe absente">
        <Select value={absent} onChange={(e) => setAbsent(e.target.value)}>
          <option value="">choisir</option>
          <option value={m.homeId!}>{m.home}</option>
          <option value={m.awayId!}>{m.away}</option>
        </Select>
      </Field>
      <p className="text-sm text-text">L'autre équipe gagne chaque map qui lui manque 13-0 et passe au tour suivant.</p>
      <Button small danger type="submit" disabled={action.busy || !absent}>
        Déclarer forfait
      </Button>
      <Button small onClick={onDone}>
        Annuler
      </Button>
    </form>
  );
}

function FormatPanel({ m, action, onDone }: { m: OverviewMatch; action: Action; onDone: () => void }) {
  const [format, setFormat] = useState(m.format === 'BO1' ? 'BO3' : 'BO1');
  return (
    <form
      className={panelClass}
      onSubmit={async (e: FormEvent) => {
        e.preventDefault();
        if (
          await action.run(`Format passé en ${format}`, () =>
            api('/api/tournament/matches/format', { method: 'POST', body: JSON.stringify({ matchIds: [m.id], format }) }),
          )
        )
          onDone();
      }}
    >
      <Field label="Nouveau format">
        <Select value={format} onChange={(e) => setFormat(e.target.value)}>
          <option>BO1</option>
          <option>BO3</option>
          <option>BO5</option>
        </Select>
      </Field>
      <p className="text-sm text-text">Un véto déjà commencé est effacé.</p>
      <Button small primary type="submit" disabled={action.busy || format === m.format}>
        Changer le format
      </Button>
      <Button small onClick={onDone}>
        Annuler
      </Button>
    </form>
  );
}

function ReplacePanel({ m, teams, action, onDone }: { m: OverviewMatch; teams: TournamentTeam[]; action: Action; onDone: () => void }) {
  const [out, setOut] = useState('');
  const [replacement, setReplacement] = useState('');
  const others = teams.filter((t) => t.id !== m.homeId && t.id !== m.awayId);
  return (
    <form
      className={panelClass}
      onSubmit={async (e: FormEvent) => {
        e.preventDefault();
        if (
          await action.run('Équipe remplacée', () =>
            api(`/api/tournament/matches/${m.id}/replace-team`, { method: 'POST', body: JSON.stringify({ teamId: out, newTeamId: replacement }) }),
          )
        )
          onDone();
      }}
    >
      <Field label="Équipe qui sort">
        <Select value={out} onChange={(e) => setOut(e.target.value)}>
          <option value="">choisir</option>
          <option value={m.homeId!}>{m.home}</option>
          <option value={m.awayId!}>{m.away}</option>
        </Select>
      </Field>
      <Field label="Remplacée par">
        <Select value={replacement} onChange={(e) => setReplacement(e.target.value)}>
          <option value="">choisir</option>
          {others.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </Select>
      </Field>
      <Button small primary type="submit" disabled={action.busy || !out || !replacement}>
        Remplacer
      </Button>
      <Button small onClick={onDone}>
        Annuler
      </Button>
    </form>
  );
}

/** A game result entered by the admin (server down, game played elsewhere); the series and the bracket follow. */
function ResultPanel({ m, order, defaultMap, action, onDone }: { m: OverviewMatch; order: number; defaultMap: string; action: Action; onDone: () => void }) {
  const [home, setHome] = useState('');
  const [away, setAway] = useState('');
  const [map, setMap] = useState(defaultMap);
  const valid = /^\d+$/.test(home) && /^\d+$/.test(away);
  return (
    <form
      className={panelClass}
      onSubmit={async (e: FormEvent) => {
        e.preventDefault();
        const ok = await action.run(`Résultat du game ${order} enregistré`, () =>
          api(`/api/tournament/matches/${m.id}/games/${order}/result`, {
            method: 'POST',
            body: JSON.stringify({ scoreHome: Number(home), scoreAway: Number(away), mapName: map.trim() || undefined }),
          }),
        );
        if (ok) onDone();
      }}
    >
      {!!m.advantageHome && (
        <p className="w-full text-sm text-muted">
          {m.home} a {m.advantageHome} map d'avance : s'il gagne ce game, la finale est finie ; sinon un game de plus se joue.
        </p>
      )}
      <Field label={`Game ${order}, score de ${m.home}`}>
        <Input inputMode="numeric" value={home} onChange={(e) => setHome(e.target.value.replace(/\D/g, ''))} className="w-20 font-mono" />
      </Field>
      <Field label={`score de ${m.away}`}>
        <Input inputMode="numeric" value={away} onChange={(e) => setAway(e.target.value.replace(/\D/g, ''))} className="w-20 font-mono" />
      </Field>
      <Field label="Map">
        <Input value={map} onChange={(e) => setMap(e.target.value)} placeholder="de_mirage" className="w-32 font-mono" />
      </Field>
      <Button small primary type="submit" disabled={action.busy || !valid}>
        Enregistrer
      </Button>
      <Button small onClick={onDone}>
        Annuler
      </Button>
    </form>
  );
}

/**
 * Correction of a game of a finished match (asked by the user: a wrong score could not be fixed). Same winner: the
 * scores change; another winner: the bracket moves the teams again, refused once a following match has started.
 */
function CorrectPanel({ m, action, onDone }: { m: OverviewMatch; action: Action; onDone: () => void }) {
  const played = m.games.filter((g) => g.status === 'FINISHED');
  const [order, setOrder] = useState(played[0]?.order ?? 1);
  const game = played.find((g) => g.order === order);
  const [home, setHome] = useState(String(game?.scoreHome ?? ''));
  const [away, setAway] = useState(String(game?.scoreAway ?? ''));
  const pick = (o: number) => {
    const g = played.find((x) => x.order === o);
    setOrder(o);
    setHome(String(g?.scoreHome ?? ''));
    setAway(String(g?.scoreAway ?? ''));
  };
  const valid = /^\d+$/.test(home) && /^\d+$/.test(away);
  return (
    <form
      className={panelClass}
      onSubmit={async (e: FormEvent) => {
        e.preventDefault();
        const ok = await action.run(`Game ${order} corrigé`, () =>
          api(`/api/tournament/matches/${m.id}/games/${order}/correct`, {
            method: 'POST',
            body: JSON.stringify({ scoreHome: Number(home), scoreAway: Number(away) }),
          }),
        );
        if (ok) onDone();
      }}
    >
      <p className="w-full text-sm text-muted">
        Si le vainqueur change, l'arbre est remis à jour (refusé si un match suivant a déjà commencé : corrigez-le d'abord).
      </p>
      {played.length > 1 && (
        <Field label="Game">
          <Select value={order} onChange={(e) => pick(Number(e.target.value))}>
            {played.map((g) => (
              <option key={g.order} value={g.order}>
                Game {g.order} {g.mapName !== '-' ? g.mapName : ''} ({g.scoreHome}-{g.scoreAway})
              </option>
            ))}
          </Select>
        </Field>
      )}
      <Field label={`${played.length > 1 ? '' : `Game ${order}, `}score de ${m.home}`}>
        <Input inputMode="numeric" value={home} onChange={(e) => setHome(e.target.value.replace(/\D/g, ''))} className="w-20 font-mono" />
      </Field>
      <Field label={`score de ${m.away}`}>
        <Input inputMode="numeric" value={away} onChange={(e) => setAway(e.target.value.replace(/\D/g, ''))} className="w-20 font-mono" />
      </Field>
      <Button small primary type="submit" disabled={action.busy || !valid}>
        Corriger
      </Button>
      <Button small onClick={onDone}>
        Annuler
      </Button>
    </form>
  );
}
