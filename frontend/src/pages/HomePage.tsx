import type { LiveGame, TournamentSummary } from '../lib/api';
import { usePolling } from '../lib/usePolling';
import { Empty, LiveGamesTable, Section, TOURNAMENT_STATUS } from '../components/live';

/**
 * Public home of the LAN: the games being played (spectators following the tournament, players waiting for their
 * turn), then the tournaments. The same live view as the admin dashboard, without its admin side (servers, frozen
 * results). Refreshed every few seconds, never reloaded.
 */
export function HomePage() {
  const live = usePolling<LiveGame[]>('/api/tournament/live');
  const tournaments = usePolling<TournamentSummary[]>('/api/tournament/tournaments', 30_000);
  const ongoing = tournaments.data?.filter((t) => t.status !== 'ARCHIVED') ?? [];

  return (
    <div className="space-y-12">
      <Section title="En direct" count={live.data?.length} error={live.error}>
        {live.data && live.data.length === 0 && <Empty>Aucun match en cours pour l'instant.</Empty>}
        {live.data && live.data.length > 0 && <LiveGamesTable games={live.data} />}
      </Section>

      <Section title="Tournois" error={tournaments.error}>
        {tournaments.data && ongoing.length === 0 && <Empty>Aucun tournoi pour l'instant.</Empty>}
        {ongoing.length > 0 && (
          <ul className="divide-y divide-line border-y border-line">
            {ongoing.map((t) => (
              <li key={t.id} className="flex items-baseline gap-4 py-3">
                {/* the tournament page of the new front comes later: the server page meanwhile */}
                <a href={`/view/tournaments/${t.id}`} className="font-semibold text-white hover:underline">
                  {t.name}
                </a>
                <span className="text-sm text-muted">{t.game}</span>
                <span className={`ml-auto text-sm ${t.status === 'ACTIVE' ? 'text-ok' : 'text-muted'}`}>
                  {TOURNAMENT_STATUS[t.status] ?? t.status}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
