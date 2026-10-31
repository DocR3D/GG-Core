import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router';
import { api, ApiError, type LiveGame } from '../lib/api';
import { describe, type LogLine } from '../lib/events';
import { liveSocket } from '../lib/live';
import { isAdmin, useSession } from '../lib/session';
import { usePolling } from '../lib/usePolling';
import { TeamLine } from '../components/live';
import { Button } from '../components/ui';

/**
 * Match console (admins): one game of the real-time engine. Score and state, the commands (each through the API,
 * recorded with its author), and the event log: history on open, then live through the WebSocket.
 */
export function MatchConsolePage() {
  const session = useSession();
  const { gameId = '' } = useParams();
  if (session.status === 'loading') return null;
  if (!isAdmin(session)) {
    return (
      <p className="text-muted">
        Réservé aux admins.{' '}
        <a href={`/login?next=/admin/games/${gameId}`} className="text-white underline">
          Se connecter
        </a>
      </p>
    );
  }
  return <Console gameId={gameId} />;
}

interface Snapshot {
  phase: string | null;
  score: { ct: number; t: number; round: number };
  sides: { home: 'CT' | 'T'; away: 'CT' | 'T' } | null;
  pause: { state: string; reason: string | null } | null;
  teams: { home_name: string | null; away_name: string | null };
}

const WARMUPS = new Set(['warmup_knife', 'warmup_main', 'half_time']);
const PLAYING = new Set(['live_main', 'overtime']);
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

function Console({ gameId }: { gameId: string }) {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [review, setReview] = useState<{ reason: string; serverScore: { ct: number; t: number } } | null>(null);
  const [log, setLog] = useState<LogLine[]>([]);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  // where the game sits (server, map, tournament): from the live list, refreshed slowly
  const live = usePolling<LiveGame[]>('/api/tournament/live', 15_000);
  const info = live.data?.find((g) => g.gameId === gameId);

  const refresh = useCallback(() => {
    api<Snapshot>(`/api/matches/${gameId}/snapshot`).then(setSnap).catch(() => undefined);
    // the route answers { matchId, review: null | { … } }
    api<{ review: typeof review }>(`/api/matches/${gameId}/review`)
      .then((r) => setReview(r?.review ?? null))
      .catch(() => undefined);
  }, [gameId]);

  // history once, then live events; the state is re-read after each event (debounced) and every 10 s anyway
  useEffect(() => {
    refresh();
    const poll = setInterval(refresh, 10_000);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const soon = () => {
      clearTimeout(timer);
      timer = setTimeout(refresh, 300);
    };
    api<{ id: string; timestamp: number; type: string; payload: any }[]>(`/api/matches/${gameId}/events?limit=300`)
      .then((rows) =>
        setLog((current) => [
          ...rows.flatMap((r) => {
            const d = describe(r.type, r.payload);
            return d ? [{ key: `h${r.id}`, at: r.timestamp, ...d }] : [];
          }),
          ...current,
        ]),
      )
      .catch(() => undefined);

    const socket = liveSocket();
    const subscribe = () => socket.emit('match:subscribe', { matchId: gameId });
    const onEvent = (type: string, dto: any) => {
      if (dto?.matchId !== gameId) return;
      soon();
      const d = describe(type, dto.payload ?? dto);
      if (d) setLog((l) => [...l.slice(-499), { key: `w${dto.seq ?? Math.random()}-${type}`, at: dto.ts ?? Date.now(), ...d }]);
    };
    subscribe();
    socket.on('connect', subscribe); // after a reconnection
    socket.onAny(onEvent);
    return () => {
      clearInterval(poll);
      clearTimeout(timer);
      socket.off('connect', subscribe);
      socket.offAny(onEvent);
      socket.emit('match:unsubscribe', { matchId: gameId });
    };
  }, [gameId, refresh]);

  /** Runs a command; its answer (or the reason it was refused) is shown under the buttons. */
  const run = async (label: string, path: string, body?: unknown) => {
    setBusy(true);
    setNotice(null);
    try {
      await api(`/api/matches/${gameId}/${path}`, { method: 'POST', body: body ? JSON.stringify(body) : undefined });
      setNotice({ ok: true, text: `${label} : fait.` });
      refresh();
      return true;
    } catch (e) {
      setNotice({ ok: false, text: `${label} : refusé. ${e instanceof ApiError ? e.message : ''}` });
      return false;
    } finally {
      setBusy(false);
    }
  };

  const phase = snap?.phase ?? null;
  const paused = snap?.pause?.state === 'paused';
  const homeSide = snap?.sides?.home ?? 'CT';
  const score = (logical: 'home' | 'away') => {
    const s = logical === 'home' ? homeSide : homeSide === 'CT' ? 'T' : 'CT';
    return snap ? (s === 'CT' ? snap.score.ct : snap.score.t) : 0;
  };

  return (
    <div className="space-y-8">
      <div>
        <Link to="/admin" className="text-sm text-muted hover:text-white">
          Tableau de bord
        </Link>
        <h1 className="mt-1 text-3xl font-semibold text-white">
          {snap?.teams.home_name ?? info?.home ?? '?'} contre {snap?.teams.away_name ?? info?.away ?? '?'}
        </h1>
        {info && (
          <p className="mt-1 text-muted">
            {info.mapName}, game {info.order} de {info.match.format}, serveur <span className="font-mono">{info.server}</span>,{' '}
            <a href={`/view/matches/${info.match.id}`} className="hover:text-white">
              {info.tournament.name}
            </a>
          </p>
        )}
      </div>

      <div className="grid gap-8 md:grid-cols-[minmax(0,22rem)_1fr]">
        <div className="space-y-2 border-y border-line py-4 text-2xl">
          <TeamLine name={snap?.teams.home_name ?? null} side={snap?.sides?.home} score={score('home')} />
          <TeamLine name={snap?.teams.away_name ?? null} side={snap?.sides?.away} score={score('away')} />
        </div>
        <div className="py-4">
          <div className={phase && PLAYING.has(phase) ? 'text-xl text-ok' : 'text-xl text-text'}>
            {phase ? (PHASE[phase] ?? phase) : 'Pas de match sur un serveur'}
            {phase && PLAYING.has(phase) && <span className="text-muted">, round {snap?.score.round}</span>}
          </div>
          {paused && (
            <div className="mt-1 text-pause">
              En pause {snap?.pause?.reason === 'technical' ? 'technique' : snap?.pause?.reason === 'tactical' ? 'tactique' : ''}
            </div>
          )}
        </div>
      </div>

      {review && (
        <div className="border-l-2 border-red bg-surface px-4 py-3">
          <p className="text-white">
            Résultat gelé : le serveur a fini le match sur {review.serverScore.ct}-{review.serverScore.t} (CT-T), ce qui
            contredit GG-Core.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button primary disabled={busy} onClick={() => run('Score du serveur accepté', 'review/accept-server')}>
              Accepter le score du serveur
            </Button>
            <Button disabled={busy} onClick={() => run('Gel levé', 'review/dismiss')}>
              Lever le gel
            </Button>
          </div>
        </div>
      )}

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-white">Commandes</h2>
        <div className="flex flex-wrap items-center gap-2">
          {paused ? (
            <Button primary disabled={busy} onClick={() => run('Reprise', 'unpause')}>
              Reprendre
            </Button>
          ) : (
            <Button disabled={busy || !phase || phase === 'postgame'} onClick={() => run('Pause technique', 'pause')}>
              Pause technique
            </Button>
          )}
          {!paused && (
            <Button disabled={busy} onClick={() => run('Reprise', 'unpause')} title="Relance aussi le serveur après sa pause automatique d'un round rejoué">
              Reprendre le serveur
            </Button>
          )}
          <Button primary={!!phase && WARMUPS.has(phase)} disabled={busy || !phase || !WARMUPS.has(phase)} onClick={() => run('Départ forcé', 'force-start')}>
            Forcer le départ
          </Button>
          <Button disabled={busy || (phase !== 'warmup_knife' && phase !== 'warmup_main')} onClick={() => run('Échange des camps', 'swap-teams')}>
            Échanger les camps
          </Button>
        </div>
        <RestoreRound disabled={busy || !phase || !PLAYING.has(phase)} current={snap?.score.round ?? 0} onRestore={(round) => run(`Round ${round} rejoué`, 'restore', { round })} />
        <SayForm disabled={busy} onSay={(message) => run('Message envoyé', 'say', { message })} />
        {notice && <p className={notice.ok ? 'text-sm text-ok' : 'text-sm text-red-light'}>{notice.text}</p>}
      </section>

      <section>
        <h2 className="text-xl font-semibold text-white">Journal</h2>
        <EventLog lines={log} />
      </section>
    </div>
  );
}

/** Replays a round: asks for its number, then a confirmation (it rolls the score and the stats back). */
function RestoreRound({ disabled, current, onRestore }: { disabled: boolean; current: number; onRestore: (round: number) => Promise<boolean> }) {
  const [round, setRound] = useState('');
  const [confirm, setConfirm] = useState(false);
  const n = Number(round);
  const valid = Number.isInteger(n) && n >= 1 && n <= current;
  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        if (valid) setConfirm(true);
      }}
    >
      <label htmlFor="round" className="text-text">
        Rejouer le round
      </label>
      <input
        id="round"
        inputMode="numeric"
        value={round}
        onChange={(e) => {
          setRound(e.target.value.replace(/\D/g, ''));
          setConfirm(false);
        }}
        disabled={disabled}
        placeholder={current ? `1 à ${current}` : ''}
        className="w-24 border border-line-strong bg-surface px-2 py-1.5 font-mono text-white disabled:opacity-50"
      />
      {!confirm ? (
        <Button type="submit" disabled={disabled || !valid}>
          Rejouer
        </Button>
      ) : (
        <>
          <span className="text-text">Le score et les stats reviennent au début du round {n}, le serveur se met en pause.</span>
          <Button
            primary
            onClick={async () => {
              if (await onRestore(n)) setRound('');
              setConfirm(false);
            }}
          >
            Confirmer
          </Button>
          <Button onClick={() => setConfirm(false)}>Annuler</Button>
        </>
      )}
    </form>
  );
}

function SayForm({ disabled, onSay }: { disabled: boolean; onSay: (message: string) => Promise<boolean> }) {
  const [message, setMessage] = useState('');
  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={async (e: FormEvent) => {
        e.preventDefault();
        if (message.trim() && (await onSay(message))) setMessage('');
      }}
    >
      <label htmlFor="say" className="text-text">
        Message dans le jeu
      </label>
      <input
        id="say"
        value={message}
        maxLength={180}
        onChange={(e) => setMessage(e.target.value)}
        disabled={disabled}
        className="min-w-0 flex-1 border border-line-strong bg-surface px-2 py-1.5 text-white disabled:opacity-50 sm:max-w-md"
      />
      <Button type="submit" disabled={disabled || !message.trim()}>
        Envoyer
      </Button>
    </form>
  );
}

/** Newest at the bottom, kept in view while the log grows (unless the admin scrolled up to read). */
function EventLog({ lines }: { lines: LogLine[] }) {
  const box = useRef<HTMLOListElement>(null);
  const stick = useRef(true);
  useEffect(() => {
    const el = box.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [lines]);
  if (!lines.length) return <p className="mt-4 text-muted">Rien pour l'instant : les rounds, les kills, le chat et les actions des admins s'affichent ici.</p>;
  return (
    <ol
      ref={box}
      onScroll={(e) => {
        const el = e.currentTarget;
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
      }}
      className="mt-4 max-h-[28rem] overflow-y-auto border-y border-line py-2 font-mono text-sm"
    >
      {lines.map((l) => (
        <li key={l.key} className="flex gap-3 py-0.5">
          <time className="shrink-0 text-muted">{new Date(l.at).toLocaleTimeString('fr-FR')}</time>
          <span className={TONE[l.tone]}>{l.text}</span>
        </li>
      ))}
    </ol>
  );
}

const TONE: Record<LogLine['tone'], string> = {
  normal: 'text-text',
  muted: 'text-muted',
  admin: 'text-white',
  alert: 'text-red-light',
};
