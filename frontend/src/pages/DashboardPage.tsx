import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { api, type LiveGame, type ServerRow, type TournamentSummary } from '../lib/api';
import { Button, Input, NoticeLine, useAction } from '../components/ui';
import { isAdmin, useSession } from '../lib/session';
import { usePolling } from '../lib/usePolling';
import { ago, Empty, LiveGamesTable, Section, Table, Td, TOURNAMENT_STATUS, useNow } from '../components/live';

/**
 * Admin dashboard: the games being played (the reason to open it), the servers and what their agent reports, the
 * tournaments. Refreshed every few seconds, never reloaded. The public version of the games is the home page.
 */
export function DashboardPage() {
  const session = useSession();
  if (session.status === 'loading') return null;
  if (!isAdmin(session)) {
    return (
      <section>
        <h1 className="text-3xl font-semibold text-white">Tableau de bord</h1>
        <p className="mt-4 text-muted">
          Réservé aux admins.{' '}
          <a href="/login?next=/admin" className="text-white underline">
            Se connecter
          </a>
        </p>
      </section>
    );
  }
  return <Dashboard />;
}

function Dashboard() {
  const live = usePolling<LiveGame[]>('/api/tournament/live');
  const servers = usePolling<ServerRow[]>('/api/tournament/servers');
  const tournaments = usePolling<TournamentSummary[]>('/api/tournament/tournaments', 30_000);
  const now = useNow();

  return (
    <div className="space-y-12">
      <header className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h1 className="text-3xl font-semibold text-white">Tableau de bord</h1>
        {live.at && <p className="text-sm text-muted">mis à jour {ago(live.at, now)}</p>}
      </header>

      <Section title="En cours" count={live.data?.length} error={live.error}>
        {live.data && live.data.length === 0 && <Empty>Aucun game en cours. Un game lancé apparaît ici.</Empty>}
        {live.data && live.data.length > 0 && <LiveGamesTable games={live.data} admin />}
      </Section>

      <Section title="Serveurs" count={servers.data?.length} error={servers.error}>
        {servers.data && servers.data.length === 0 && (
          <Empty>
            Aucun serveur enregistré. Ajouter un serveur CS2 : <code className="font-mono text-text">make server NAME=srv-b IP=…</code>
          </Empty>
        )}
        {servers.data && servers.data.length > 0 && (
          <Table head={['Serveur', 'Adresse', 'Disponibilité', 'Agent', 'Logs CS2']}>
            {servers.data.map((s) => (
              <ServerLine key={s.id} s={s} now={now} />
            ))}
          </Table>
        )}
      </Section>

      <Section title="Tournois" count={tournaments.data?.length} error={tournaments.error}>
        <NewTournament />
        {tournaments.data && tournaments.data.length === 0 && <Empty>Aucun tournoi.</Empty>}
        {tournaments.data && tournaments.data.length > 0 && (
          <ul className="divide-y divide-line border-y border-line">
            {tournaments.data.map((t) => (
              <li key={t.id} className="flex items-baseline gap-4 py-2.5">
                <Link to={`/admin/tournaments/${t.id}`} className="font-semibold text-white hover:underline">
                  {t.name}
                </Link>
                <span className="text-sm text-muted">{TOURNAMENT_STATUS[t.status] ?? t.status}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

function ServerLine({ s, now }: { s: ServerRow; now: number }) {
  const a = s.agent;
  return (
    <tr>
      <Td className="font-mono text-white">{s.name}</Td>
      <Td className="font-mono text-sm text-muted">
        {s.ip}:{s.port}
      </Td>
      <Td>
        {s.availability === 'busy' && <span className="text-ok">occupé</span>}
        {s.availability === 'free' && <span className="text-text">libre</span>}
        {s.availability === 'disabled' && <span className="text-muted">désactivé</span>}
      </Td>
      <Td>
        {!a.online && <span className="text-red-light">agent arrêté</span>}
        {a.online && a.rconConnected && <span className="text-text">RCON connecté</span>}
        {a.online && !a.rconConnected && (
          <span className="text-red-light" title={a.rconError}>
            RCON injoignable
          </span>
        )}
      </Td>
      <Td className="text-sm">
        {a.lastBadTokenAt && <div className="text-red-light">refusés {ago(Date.parse(a.lastBadTokenAt), now)} : mauvais jeton</div>}
        {a.lastLogAt ? <span className="text-muted">reçus {ago(Date.parse(a.lastLogAt), now)}</span> : <span className="text-muted">aucun</span>}
      </Td>
    </tr>
  );
}

/** Creates a tournament and opens its management screen. */
function NewTournament() {
  const [name, setName] = useState('');
  const navigate = useNavigate();
  const { busy, notice, run } = useAction();
  return (
    <div className="mb-4 space-y-2">
      <form
        className="flex flex-wrap gap-2"
        onSubmit={async (e: FormEvent) => {
          e.preventDefault();
          const t = await run('Tournoi créé', () => api<{ id: string }>('/api/tournament/tournaments', { method: 'POST', body: JSON.stringify({ name: name.trim() }) }));
          if (t?.id) navigate(`/admin/tournaments/${t.id}`);
        }}
      >
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nom du nouveau tournoi" className="sm:w-72" />
        <Button type="submit" disabled={busy || !name.trim()}>
          Créer le tournoi
        </Button>
      </form>
      <NoticeLine notice={notice} />
    </div>
  );
}
