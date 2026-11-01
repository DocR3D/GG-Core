import { useEffect, useState, type FormEvent } from 'react';
import { api, type VetoConfig, type VetoItem } from '../../lib/api';
import { Button, Field, Input, Select, type Action } from '../../components/ui';
import type { VetoLine } from './model';

/** A starting pool to edit (seven maps: the veto sequences are built for seven). */
const SUGGESTED_POOL = ['de_ancient', 'de_anubis', 'de_dust2', 'de_inferno', 'de_mirage', 'de_nuke', 'de_train'];

/**
 * Map pool and side mode of the tournament: without them no veto can start. Knife: a knife round on every map;
 * pick: on a picked map the opponent of the picker chooses its side (knife on the decider).
 */
export function VetoSettings({ tournamentId, action }: { tournamentId: string; action: Action }) {
  const [config, setConfig] = useState<VetoConfig | null | undefined>(undefined);
  const [pool, setPool] = useState<string[]>([]);
  const [sideMode, setSideMode] = useState<'knife' | 'pick'>('knife');
  const [adding, setAdding] = useState('');
  useEffect(() => {
    api<VetoConfig | null>(`/api/tournament/tournaments/${tournamentId}/veto`)
      .then((c) => {
        setConfig(c);
        setPool(c?.mapPool ?? SUGGESTED_POOL);
        setSideMode(c?.sideMode ?? 'knife');
      })
      .catch(() => setConfig(null));
  }, [tournamentId]);
  if (config === undefined) return null;
  const changed = !config || config.sideMode !== sideMode || config.mapPool.join() !== pool.join();
  return (
    <form
      className="space-y-3"
      onSubmit={async (e: FormEvent) => {
        e.preventDefault();
        const saved = await action.run('Véto enregistré', () =>
          api<VetoConfig>(`/api/tournament/tournaments/${tournamentId}/veto`, { method: 'PUT', body: JSON.stringify({ mapPool: pool, sideMode }) }),
        );
        if (saved) setConfig(saved);
      }}
    >
      {!config && <p className="text-sm text-pause">Pas encore de pool de maps : les vétos ne peuvent pas commencer.</p>}
      <ul className="flex flex-wrap gap-2">
        {pool.map((m) => (
          <li key={m} className="flex items-center gap-2 border border-line-strong px-2 py-1 font-mono text-sm text-white">
            {m}
            <button type="button" className="text-muted hover:text-red-light" onClick={() => setPool(pool.filter((x) => x !== m))} aria-label={`Retirer ${m}`}>
              retirer
            </button>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Ajouter une map">
          <Input value={adding} onChange={(e) => setAdding(e.target.value.trim())} placeholder="de_overpass" className="font-mono" />
        </Field>
        <Button
          small
          disabled={!adding || pool.includes(adding)}
          onClick={() => {
            setPool([...pool, adding]);
            setAdding('');
          }}
        >
          Ajouter
        </Button>
        <Field label="Camps">
          <Select value={sideMode} onChange={(e) => setSideMode(e.target.value as 'knife' | 'pick')}>
            <option value="knife">knife sur chaque map</option>
            <option value="pick">choisis au véto</option>
          </Select>
        </Field>
        <Button primary={!config} type="submit" disabled={action.busy || pool.length < 1 || !changed}>
          Enregistrer le véto
        </Button>
      </div>
    </form>
  );
}

/** Where the veto of a match stands, in one short line (who is expected, or why it is not open). */
export function vetoLine(v: VetoItem | undefined, names: Record<string, string>): VetoLine {
  if (!v) return null;
  const who = v.waitingFor.map((id) => names[id] ?? '?').join(' et ');
  switch (v.phase) {
    case 'rps':
      return { text: `véto : pierre-feuille-ciseaux, attendu de ${who}`, tone: 'text-text' };
    case 'rps_decision':
      return { text: `véto : ${who} choisit qui commence`, tone: 'text-text' };
    case 'veto':
      return { text: `véto : à ${who} de jouer`, tone: 'text-text' };
    case 'done':
      return { text: 'véto fini', tone: 'text-muted' };
    default: {
      const round = v.reason?.match(/round (\d+)/)?.[1];
      if (v.reason?.startsWith('veto opens after round')) return { text: `véto : s'ouvre après le tour ${round}`, tone: 'text-muted' };
      if (v.reason?.startsWith('no map pool')) return { text: 'véto : pas de pool de maps', tone: 'text-pause' };
      return null;
    }
  }
}
