import { useEffect, useState } from 'react';
import { api, type SimulationRun } from '../../lib/api';
import { Button, useAction } from '../../components/ui';

/**
 * A Sandbox tournament played "au fur et à mesure": where the simulation stands, Pause / Reprendre / Game suivant /
 * Arrêter, and the screen refreshed after every poll while it plays (asked by the user: watch it being played).
 */
export function SimulationBar({ tournamentId, onTick }: { tournamentId: string; onTick: () => void }) {
  const [run, setRun] = useState<SimulationRun | null>(null);
  const action = useAction();
  useEffect(() => {
    let alive = true;
    let active = true;
    const poll = async () => {
      const runs = await api<SimulationRun[]>('/sandbox/tournament/runs', { quiet: true }).catch(() => null);
      if (!alive || !runs) return;
      const mine = runs.find((r) => r.tournamentId === tournamentId) ?? null;
      setRun(mine);
      const now = !!mine && (mine.status === 'running' || mine.status === 'paused');
      // refresh while it plays, and once more when it ends
      if (now || active) onTick();
      active = now;
    };
    poll();
    const timer = setInterval(poll, 2500);
    return () => {
      alive = false;
      clearInterval(timer);
    };
    // onTick changes every render: the poll keeps the first one, which reloads this tournament
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tournamentId]);
  if (!run) return null;
  const control = (what: string, label: string) =>
    action.run(label, () => api<SimulationRun>(`/sandbox/tournament/runs/${run.id}/${what}`, { method: 'POST' }).then(setRun));
  const state = { running: 'en cours', paused: 'en pause', done: 'terminée', stopped: 'arrêtée', error: `erreur : ${run.error ?? ''}` }[run.status];
  return (
    <div className="flex flex-wrap items-center gap-3 border border-line-strong bg-surface px-4 py-2 text-sm">
      <span className={run.status === 'running' ? 'text-ok' : run.status === 'error' ? 'text-red-light' : 'text-pause'}>Simulation {state}</span>
      <span className="text-text">{run.phase}</span>
      <span className="text-muted">
        {run.seriesPlayed} séries, {run.gamesPlayed} games joués
      </span>
      <span className="ml-auto flex flex-wrap gap-2">
        {run.status === 'running' && (
          <Button small disabled={action.busy} onClick={() => control('pause', 'Simulation en pause')}>
            Pause
          </Button>
        )}
        {run.status === 'paused' && (
          <>
            <Button small primary disabled={action.busy} onClick={() => control('resume', 'Simulation reprise')}>
              Reprendre
            </Button>
            <Button small disabled={action.busy} onClick={() => control('step', 'Un game de plus')}>
              Game suivant
            </Button>
          </>
        )}
        {(run.status === 'running' || run.status === 'paused') && (
          <Button small danger disabled={action.busy} onClick={() => control('stop', 'Simulation arrêtée')}>
            Arrêter
          </Button>
        )}
      </span>
    </div>
  );
}
