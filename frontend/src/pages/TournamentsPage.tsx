import type { TournamentSummary } from '../lib/api';
import { useApi } from '../lib/useApi';

const STATUS: Record<TournamentSummary['status'], { label: string; tone: string }> = {
  ACTIVE: { label: 'en cours', tone: 'text-ok' },
  UPCOMING: { label: 'à venir', tone: 'text-text' },
  COMPLETED: { label: 'terminé', tone: 'text-muted' },
  ARCHIVED: { label: 'archivé', tone: 'text-muted' },
};

export function TournamentsPage() {
  const list = useApi<TournamentSummary[]>('/api/tournament/tournaments');
  return (
    <section>
      <h1 className="text-3xl font-semibold text-white">Tournois</h1>
      {list.status === 'loading' && <p className="mt-6 text-muted">Chargement des tournois…</p>}
      {list.status === 'error' && <p className="mt-6 text-red-light">Impossible de charger les tournois : {list.message}</p>}
      {list.status === 'ok' && list.data.length === 0 && (
        <p className="mt-6 text-muted">Aucun tournoi pour l'instant.</p>
      )}
      {list.status === 'ok' && list.data.length > 0 && (
        <ul className="mt-6 divide-y divide-line border-y border-line">
          {list.data.map((t) => (
            <li key={t.id} className="flex items-baseline gap-4 py-3">
              {/* the tournament page of the new front comes later: the server page meanwhile */}
              <a href={`/view/tournaments/${t.id}`} className="font-semibold text-white hover:underline">
                {t.name}
              </a>
              <span className="text-sm text-muted">{t.game}</span>
              <span className={`ml-auto text-sm ${STATUS[t.status]?.tone ?? 'text-muted'}`}>{STATUS[t.status]?.label ?? t.status}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
