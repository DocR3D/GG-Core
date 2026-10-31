import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { api, type Overview, type OverviewMatch, type ServerRow, type TournamentSummary, type TournamentTeam } from '../lib/api';
import { isAdmin, useSession } from '../lib/session';
import { Empty, Section, TOURNAMENT_STATUS } from '../components/live';
import { Button, Input, NoticeLine, Select, useAction } from '../components/ui';

/**
 * Managing one tournament (admins): its name and status, its teams and their players (SteamID, captain), its
 * matches (bonus match, game launch → match console). Stages (groups, bracket, qualification) come next.
 */
export function TournamentAdminPage() {
  const session = useSession();
  const { tournamentId = '' } = useParams();
  if (session.status === 'loading') return null;
  if (!isAdmin(session)) {
    return (
      <p className="text-muted">
        Réservé aux admins.{' '}
        <a href={`/login?next=/admin/tournaments/${tournamentId}`} className="text-white underline">
          Se connecter
        </a>
      </p>
    );
  }
  return <TournamentAdmin id={tournamentId} />;
}

function TournamentAdmin({ id }: { id: string }) {
  const [summary, setSummary] = useState<TournamentSummary | null>(null);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [teams, setTeams] = useState<TournamentTeam[] | null>(null);
  const [missing, setMissing] = useState(false);

  const reload = useCallback(() => {
    api<TournamentSummary[]>('/api/tournament/tournaments').then((l) => {
      const t = l.find((x) => x.id === id) ?? null;
      setSummary(t);
      setMissing(!t);
    });
    api<Overview>(`/api/tournament/tournaments/${id}/overview`).then(setOverview).catch(() => undefined);
    api<TournamentTeam[]>(`/api/tournament/tournaments/${id}/teams`).then(setTeams).catch(() => undefined);
  }, [id]);
  useEffect(reload, [reload]);

  if (missing) return <Empty>Tournoi introuvable.</Empty>;
  if (!summary) return null;
  return (
    <div className="space-y-12">
      <Header summary={summary} onChange={reload} />
      <Teams tournamentId={id} teams={teams} onChange={reload} />
      <Matches tournamentId={id} overview={overview} teams={teams ?? []} onChange={reload} />
    </div>
  );
}

// --- Name and status ------------------------------------------------------------------------------------------

function Header({ summary, onChange }: { summary: TournamentSummary; onChange: () => void }) {
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(summary.name);
  const { busy, notice, run } = useAction(onChange);
  const patch = (label: string, body: object) => run(label, () => api(`/api/tournament/tournaments/${summary.id}`, { method: 'PATCH', body: JSON.stringify(body) }));
  return (
    <header className="space-y-3">
      <Link to="/admin" className="text-sm text-muted hover:text-white">
        Tableau de bord
      </Link>
      {renaming ? (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={async (e: FormEvent) => {
            e.preventDefault();
            if (await patch('Tournoi renommé', { name })) setRenaming(false);
          }}
        >
          <Input value={name} onChange={(e) => setName(e.target.value)} className="text-2xl font-semibold sm:w-96" autoFocus />
          <Button primary type="submit" disabled={busy || !name.trim()}>
            Renommer
          </Button>
          <Button onClick={() => setRenaming(false)}>Annuler</Button>
        </form>
      ) : (
        <div className="flex flex-wrap items-baseline gap-3">
          <h1 className="text-3xl font-semibold text-white">{summary.name}</h1>
          <Button small onClick={() => setRenaming(true)}>
            Renommer
          </Button>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <label htmlFor="status" className="text-muted">
          Statut
        </label>
        <Select id="status" value={summary.status} disabled={busy} onChange={(e) => patch('Statut changé', { status: e.target.value })}>
          {Object.entries(TOURNAMENT_STATUS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
        <span className="text-muted">{summary.game}</span>
        <a href={`/view/tournaments/${summary.id}`} className="text-muted hover:text-white">
          Page publique
        </a>
      </div>
      <NoticeLine notice={notice} />
    </header>
  );
}

// --- Teams and players ----------------------------------------------------------------------------------------

function Teams({ tournamentId, teams, onChange }: { tournamentId: string; teams: TournamentTeam[] | null; onChange: () => void }) {
  const action = useAction(onChange);
  return (
    <Section title="Équipes" count={teams?.length}>
      <div className="space-y-6">
        <NewTeam tournamentId={tournamentId} action={action} />
        <NoticeLine notice={action.notice} />
        {teams && teams.length === 0 && <Empty>Aucune équipe : ajoutez-en une avec son premier joueur.</Empty>}
        {teams?.map((t) => <TeamBlock key={t.id} tournamentId={tournamentId} team={t} action={action} />)}
      </div>
    </Section>
  );
}

type Action = ReturnType<typeof useAction>;

/** A team only belongs to a tournament through its players (or its matches): created with its first player. */
function NewTeam({ tournamentId, action }: { tournamentId: string; action: Action }) {
  const [name, setName] = useState('');
  const [player, setPlayer] = useState('');
  const [steamId, setSteamId] = useState('');
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={async (e: FormEvent) => {
        e.preventDefault();
        const done = await action.run(`Équipe ${name.trim()} ajoutée`, async () => {
          const [team] = await api<{ id: string }[]>('/api/tournament/teams', { method: 'POST', body: JSON.stringify({ names: [name.trim()] }) });
          await api(`/api/tournament/tournaments/${tournamentId}/teams/${team.id}/players`, {
            method: 'POST',
            body: JSON.stringify({ players: [{ username: player.trim(), steamId: steamId.trim() || undefined, captain: true }] }),
          });
          return true;
        });
        if (done) {
          setName('');
          setPlayer('');
          setSteamId('');
        }
      }}
    >
      <Field label="Nouvelle équipe">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nom de l'équipe" />
      </Field>
      <Field label="Capitaine">
        <Input value={player} onChange={(e) => setPlayer(e.target.value)} placeholder="Pseudo" />
      </Field>
      <Field label="SteamID du capitaine">
        <Input value={steamId} onChange={(e) => setSteamId(e.target.value)} placeholder="7656… ou [U:1:…]" className="font-mono" />
      </Field>
      <Button primary type="submit" disabled={action.busy || !name.trim() || !player.trim()}>
        Ajouter l'équipe
      </Button>
    </form>
  );
}

function TeamBlock({ tournamentId, team, action }: { tournamentId: string; team: TournamentTeam; action: Action }) {
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(team.name);
  const [confirmRemove, setConfirmRemove] = useState(false);
  return (
    <div className="border-t border-line pt-4">
      <div className="flex flex-wrap items-center gap-3">
        {renaming ? (
          <form
            className="flex flex-wrap gap-2"
            onSubmit={async (e: FormEvent) => {
              e.preventDefault();
              if (await action.run('Équipe renommée', () => api(`/api/tournament/teams/${team.id}`, { method: 'PATCH', body: JSON.stringify({ name }) }))) setRenaming(false);
            }}
          >
            <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
            <Button small primary type="submit" disabled={action.busy || !name.trim()}>
              Renommer
            </Button>
            <Button small onClick={() => setRenaming(false)}>
              Annuler
            </Button>
          </form>
        ) : (
          <>
            <h3 className="text-lg font-semibold text-white">{team.name}</h3>
            <Button small onClick={() => setRenaming(true)}>
              Renommer
            </Button>
          </>
        )}
        {confirmRemove ? (
          <span className="flex items-center gap-2 text-sm">
            Retirer {team.name} du tournoi ?
            <Button
              small
              danger
              disabled={action.busy}
              onClick={() => action.run(`${team.name} retirée`, () => api(`/api/tournament/tournaments/${tournamentId}/teams/${team.id}`, { method: 'DELETE' }))}
            >
              Retirer
            </Button>
            <Button small onClick={() => setConfirmRemove(false)}>
              Annuler
            </Button>
          </span>
        ) : (
          <Button small danger onClick={() => setConfirmRemove(true)}>
            Retirer l'équipe
          </Button>
        )}
      </div>
      <ul className="mt-2 divide-y divide-line">
        {team.players.map((p) => (
          <PlayerLine key={p.id} tournamentId={tournamentId} teamId={team.id} player={p} action={action} />
        ))}
      </ul>
      <AddPlayer tournamentId={tournamentId} teamId={team.id} action={action} />
    </div>
  );
}

function PlayerLine({ tournamentId, teamId, player, action }: { tournamentId: string; teamId: string; player: TournamentTeam['players'][number]; action: Action }) {
  const [editing, setEditing] = useState(false);
  const [username, setUsername] = useState(player.username);
  const [steamId, setSteamId] = useState(player.steamId ?? '');
  if (editing) {
    return (
      <li className="py-2">
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={async (e: FormEvent) => {
            e.preventDefault();
            const ok = await action.run(`${username} modifié`, () =>
              api(`/api/tournament/players/${player.id}`, { method: 'PATCH', body: JSON.stringify({ username, steamId }) }),
            );
            if (ok) setEditing(false);
          }}
        >
          <Input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Pseudo" autoFocus />
          <Input value={steamId} onChange={(e) => setSteamId(e.target.value)} placeholder="SteamID (vide = aucun)" className="font-mono" />
          <Button small primary type="submit" disabled={action.busy || !username.trim()}>
            Enregistrer
          </Button>
          <Button small onClick={() => setEditing(false)}>
            Annuler
          </Button>
        </form>
      </li>
    );
  }
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2">
      <span className="min-w-32 text-white">{player.username}</span>
      <span className={`min-w-44 font-mono text-sm ${player.steamId ? 'text-muted' : 'text-pause'}`}>{player.steamId ?? 'pas de SteamID'}</span>
      {player.captain ? <span className="text-sm text-text">capitaine</span> : null}
      <span className="ml-auto flex gap-2">
        {!player.captain && (
          <Button
            small
            disabled={action.busy}
            onClick={() =>
              action.run(`${player.username} capitaine`, () =>
                api(`/api/tournament/tournaments/${tournamentId}/teams/${teamId}/captain`, { method: 'PUT', body: JSON.stringify({ playerId: player.id }) }),
              )
            }
          >
            Nommer capitaine
          </Button>
        )}
        <Button small onClick={() => setEditing(true)}>
          Modifier
        </Button>
        <Button
          small
          danger
          disabled={action.busy}
          onClick={() => action.run(`${player.username} retiré`, () => api(`/api/tournament/tournaments/${tournamentId}/teams/${teamId}/players/${player.id}`, { method: 'DELETE' }))}
        >
          Retirer
        </Button>
      </span>
    </li>
  );
}

function AddPlayer({ tournamentId, teamId, action }: { tournamentId: string; teamId: string; action: Action }) {
  const [username, setUsername] = useState('');
  const [steamId, setSteamId] = useState('');
  return (
    <form
      className="mt-2 flex flex-wrap items-center gap-2"
      onSubmit={async (e: FormEvent) => {
        e.preventDefault();
        const ok = await action.run(`${username.trim()} ajouté`, () =>
          api(`/api/tournament/tournaments/${tournamentId}/teams/${teamId}/players`, {
            method: 'POST',
            body: JSON.stringify({ players: [{ username: username.trim(), steamId: steamId.trim() || undefined }] }),
          }),
        );
        if (ok) {
          setUsername('');
          setSteamId('');
        }
      }}
    >
      <Input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Pseudo" />
      <Input value={steamId} onChange={(e) => setSteamId(e.target.value)} placeholder="SteamID" className="font-mono" />
      <Button small type="submit" disabled={action.busy || !username.trim()}>
        Ajouter un joueur
      </Button>
    </form>
  );
}

// --- Matches --------------------------------------------------------------------------------------------------

const MATCH_STATUS: Record<string, string> = { PENDING: 'à jouer', LIVE: 'en cours', FINISHED: 'terminé' };

function Matches({ tournamentId, overview, teams, onChange }: { tournamentId: string; overview: Overview | null; teams: TournamentTeam[]; onChange: () => void }) {
  const action = useAction(onChange);
  const [servers, setServers] = useState<ServerRow[]>([]);
  useEffect(() => {
    api<ServerRow[]>('/api/tournament/servers').then(setServers).catch(() => undefined);
  }, [overview]);
  const groups = (overview?.stages ?? []).flatMap((s) => [
    ...s.groups.map((g) => ({ title: `${s.name} - poule ${g.name}`, matches: g.matches })),
    ...(s.matches.length ? [{ title: s.name, matches: s.matches }] : []),
  ]);
  if (overview?.bonusMatches.length) groups.push({ title: 'Matchs bonus', matches: overview.bonusMatches });
  const count = groups.reduce((n, g) => n + g.matches.length, 0);
  return (
    <Section title="Matchs" count={overview ? count : undefined}>
      <div className="space-y-6">
        <BonusMatch tournamentId={tournamentId} teams={teams} action={action} />
        <NoticeLine notice={action.notice} />
        {overview && count === 0 && <Empty>Aucun match : ajoutez un match bonus, ou créez les phases (poules, arbre) - écran à venir.</Empty>}
        {groups.map((g) => (
          <div key={g.title}>
            <h3 className="text-sm text-muted">{g.title}</h3>
            <ul className="mt-1 divide-y divide-line border-y border-line">
              {g.matches.map((m) => (
                <MatchLine key={m.id} match={m} servers={servers} action={action} />
              ))}
            </ul>
          </div>
        ))}
      </div>
    </Section>
  );
}

function BonusMatch({ tournamentId, teams, action }: { tournamentId: string; teams: TournamentTeam[]; action: Action }) {
  const [home, setHome] = useState('');
  const [away, setAway] = useState('');
  const [format, setFormat] = useState('BO1');
  if (teams.length < 2) return null;
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        action.run('Match bonus ajouté', () =>
          api(`/api/tournament/tournaments/${tournamentId}/bonus-matches`, { method: 'POST', body: JSON.stringify({ homeTeamId: home, awayTeamId: away, format }) }),
        );
      }}
    >
      <Field label="Match bonus">
        <Select value={home} onChange={(e) => setHome(e.target.value)}>
          <option value="">Équipe 1</option>
          {teams.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="contre">
        <Select value={away} onChange={(e) => setAway(e.target.value)}>
          <option value="">Équipe 2</option>
          {teams.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Format">
        <Select value={format} onChange={(e) => setFormat(e.target.value)}>
          <option>BO1</option>
          <option>BO3</option>
          <option>BO5</option>
        </Select>
      </Field>
      <Button type="submit" disabled={action.busy || !home || !away || home === away}>
        Ajouter le match
      </Button>
    </form>
  );
}

/** A match: teams, score, games; the next game launched from here (map, server or the first free one). */
function MatchLine({ match: m, servers, action }: { match: OverviewMatch; servers: ServerRow[]; action: Action }) {
  const navigate = useNavigate();
  const live = m.games.find((g) => g.status === 'LIVE');
  const next = m.games.find((g) => g.status === 'PENDING') ?? null;
  const order = next?.order ?? m.games.filter((g) => g.status !== 'CANCELLED').length + 1;
  const [map, setMap] = useState(next && next.mapName !== '-' ? next.mapName : '');
  const [server, setServer] = useState('');
  const playable = m.status !== 'FINISHED' && !!m.home && !!m.away && !live;
  return (
    <li className="flex flex-wrap items-center gap-x-6 gap-y-2 py-3">
      <span className="min-w-64">
        <span className="text-white">{m.home ?? 'à déterminer'}</span>
        <span className="text-muted"> contre </span>
        <span className="text-white">{m.away ?? 'à déterminer'}</span>
      </span>
      <span className="font-mono text-sm text-muted">
        {m.format} {m.status !== 'PENDING' && `${m.scoreHome}-${m.scoreAway}`}
      </span>
      <span className={`text-sm ${m.status === 'LIVE' ? 'text-ok' : 'text-muted'}`}>{m.isForfeit ? 'forfait' : (MATCH_STATUS[m.status] ?? m.status)}</span>
      {live?.id && (
        <Link to={`/admin/games/${live.id}`} className="ml-auto text-sm font-semibold text-white underline">
          Console du game {live.order}
        </Link>
      )}
      {playable && (
        <form
          className="ml-auto flex flex-wrap items-center gap-2"
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
    </li>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-sm text-muted">
      {label}
      {children}
    </label>
  );
}
