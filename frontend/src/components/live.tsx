import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import type { LiveGame } from '../lib/api';

// Building blocks shared by the public home and the admin dashboard.

const PHASE: Record<string, string> = {
  warmup_knife: 'Warmup avant le knife',
  knife_live: 'Knife',
  knife_choice: 'Choix du camp',
  warmup_main: 'Warmup',
  live_main: 'En jeu',
  half_time: 'Mi-temps',
  overtime: 'Prolongation',
  postgame: 'Fin de match',
};
const PLAYING = new Set(['knife_live', 'live_main', 'overtime']);

export const TOURNAMENT_STATUS: Record<string, string> = { ACTIVE: 'en cours', UPCOMING: 'à venir', COMPLETED: 'terminé', ARCHIVED: 'archivé' };

/**
 * The games being played. `admin`: + the server, and "Résultat à arbitrer" when the result is frozen; the public
 * version shows neither (nothing to do for a spectator, no server address).
 */
export function LiveGamesTable({ games, admin = false }: { games: LiveGame[]; admin?: boolean }) {
  return (
    <Table head={[...(admin ? ['Serveur'] : []), 'Équipes', 'Map', 'Tournoi', 'État']}>
      {games.map((g) => (
        <tr key={g.gameId} className={admin && g.review ? 'bg-surface' : undefined}>
          {admin && <Td className="font-mono text-muted">{g.server}</Td>}
          <Td>
            {/* admins open the match console from here */}
            {admin ? (
              <Link to={`/admin/games/${g.gameId}`} className="block min-w-48 space-y-0.5 hover:bg-surface" title="Ouvrir la console du match">
                <TeamLine name={g.home} side={g.sides?.home} score={g.score.home} />
                <TeamLine name={g.away} side={g.sides?.away} score={g.score.away} />
              </Link>
            ) : (
              <div className="min-w-48 space-y-0.5">
                <TeamLine name={g.home} side={g.sides?.home} score={g.score.home} />
                <TeamLine name={g.away} side={g.sides?.away} score={g.score.away} />
              </div>
            )}
          </Td>
          <Td>
            <div className="text-text">{g.mapName}</div>
            <div className="text-sm text-muted">
              game {g.order} de {g.match.format}
              {g.match.format !== 'BO1' && `, série ${g.match.scoreHome}-${g.match.scoreAway}`}
            </div>
          </Td>
          <Td className="text-sm">
            <a href={`/view/matches/${g.match.id}`} className="text-muted hover:text-white">
              {g.tournament.name}
            </a>
          </Td>
          <Td>
            <GameState g={g} admin={admin} />
          </Td>
        </tr>
      ))}
    </Table>
  );
}

/** One team: its side in the game's colors, its name, its score in aligned figures (the live views' signature). */
export function TeamLine({ name, side, score }: { name: string | null; side?: 'CT' | 'T'; score: number }) {
  return (
    <div className="flex items-center gap-2">
      <span
        className={`h-4 w-1 shrink-0 ${side === 'CT' ? 'bg-ct' : side === 'T' ? 'bg-t' : 'bg-line-strong'}`}
        title={side ? `côté ${side}` : undefined}
      />
      <span className="flex-1 truncate text-white">{name ?? 'à déterminer'}</span>
      <span className="font-mono text-xl tabular-nums text-white">{score}</span>
    </div>
  );
}

function GameState({ g, admin }: { g: LiveGame; admin: boolean }) {
  if (admin && g.review) {
    // the one thing on the dashboard that waits for the admin: red = act now
    return (
      <a href={`/view/matches/${g.match.id}`} className="font-semibold text-red-light hover:underline">
        Résultat à arbitrer
      </a>
    );
  }
  const playing = !!g.phase && PLAYING.has(g.phase);
  return (
    <div>
      <div className={playing ? 'text-ok' : 'text-text'}>
        {g.phase ? (PHASE[g.phase] ?? g.phase) : 'inconnu'}
        {playing && <span className="text-muted">, round {g.score.round}</span>}
      </div>
      {g.pause && (
        <div className="text-sm text-pause">
          En pause {g.pause.reason === 'technical' ? 'technique' : g.pause.reason === 'tactical' ? 'tactique' : ''}
        </div>
      )}
    </div>
  );
}

export function Section({ title, count, error, children }: { title: string; count?: number; error?: string | null; children: ReactNode }) {
  return (
    <section>
      <h2 className="text-xl font-semibold text-white">
        {title}
        {count !== undefined && <span className="ml-2 font-mono text-base text-muted">{count}</span>}
      </h2>
      {error && <p className="mt-2 text-sm text-red-light">Mise à jour impossible : {error}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

export function Table({ head, children }: { head: string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-y border-line text-left">
        <thead>
          <tr className="border-b border-line text-sm text-muted">
            {head.map((h) => (
              <th key={h} className="py-2 pr-6 font-normal">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">{children}</tbody>
      </table>
    </div>
  );
}

export function Td({ className = '', children }: { className?: string; children: ReactNode }) {
  return <td className={`py-3 pr-6 align-top ${className}`}>{children}</td>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="text-muted">{children}</p>;
}

/** Re-render every second, for the "il y a N s" texts. */
export function useNow(): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

export function ago(at: number, now: number): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 5) return "à l'instant";
  if (s < 60) return `il y a ${s} s`;
  if (s < 3600) return `il y a ${Math.round(s / 60)} min`;
  return `il y a ${Math.round(s / 3600)} h`;
}
