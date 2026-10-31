import { Link, NavLink, Route, Routes, useLocation } from 'react-router';
import type { Session } from './lib/api';
import { useApi } from './lib/useApi';
import { useLiveStatus } from './lib/live';
import { TournamentsPage } from './pages/TournamentsPage';

export function App() {
  return (
    <div className="min-h-screen">
      <SiteBar />
      <main className="mx-auto max-w-5xl px-4 py-8">
        <Routes>
          <Route path="/" element={<TournamentsPage />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
    </div>
  );
}

function SiteBar() {
  const session = useApi<Session>('/auth/me');
  const live = useLiveStatus();
  const { pathname } = useLocation();
  return (
    <header className="border-b border-line">
      <nav className="mx-auto flex max-w-5xl items-center gap-6 px-4 py-3">
        <Link to="/" className="text-xl font-bold tracking-tight text-white">
          <span className="text-red">GG</span>-Core
        </Link>
        <NavLink to="/" className={({ isActive }) => (isActive ? 'text-white' : 'text-muted hover:text-white')}>
          Tournois
        </NavLink>
        <span className="ml-auto flex items-center gap-2 text-sm text-muted" title="Lien en direct avec le serveur GG-Core">
          <span className={`size-2 rounded-full ${live ? 'bg-ok' : 'bg-muted'}`} />
          {live ? 'Direct' : 'Hors ligne'}
        </span>
        {session.status === 'ok' && session.data.role !== 'visitor' ? (
          <span className="flex items-center gap-3 text-sm">
            <span>{session.data.name}</span>
            <a href="/auth/logout" className="text-muted hover:text-white">
              Se déconnecter
            </a>
          </span>
        ) : (
          <a href={`/login?next=${encodeURIComponent(pathname)}`} className="text-sm text-muted hover:text-white">
            Se connecter
          </a>
        )}
      </nav>
    </header>
  );
}

function NotFound() {
  return (
    <section>
      <h1 className="text-2xl font-semibold text-white">Page introuvable</h1>
      <p className="mt-2 text-muted">
        Cette adresse ne mène nulle part. <Link to="/" className="text-white underline">Voir les tournois</Link>
      </p>
    </section>
  );
}
