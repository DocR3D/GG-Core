import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { api } from '../lib/api';
import { isAdmin, useSession } from '../lib/session';
import { Button, Field, Input, NoticeLine, Select, useAction } from '../components/ui';
import { groupSizes, range, tournamentPath } from './tournament/model';

const STEPS = [
  { value: 'teams', label: 'équipes et phases créées (rien de généré)' },
  { value: 'groups', label: 'poules générées, rien de joué' },
  { value: 'groups_played', label: 'poules jouées, qualification à faire' },
  { value: 'qualified', label: 'équipes qualifiées, arbres générés' },
  { value: 'done', label: 'tout joué' },
];

/**
 * Sandbox: prepare a tournament to test by hand (asked by the user). Fake teams and players (first one captain),
 * the map pool, groups then Élite + Amateur (or one bracket, or none), played with fake results up to the chosen
 * step; then its management screen opens. A sandbox tournament is a normal one: delete it from its screen.
 */
export function SandboxPage() {
  const session = useSession();
  if (session.status === 'loading') return null;
  if (!isAdmin(session)) return <p className="text-muted">Réservé aux admins.</p>;
  return <Prepare />;
}

function Prepare() {
  const navigate = useNavigate();
  const action = useAction();
  const [teams, setTeams] = useState('12');
  const [groupCount, setGroupCount] = useState('2');
  const [groupFormat, setGroupFormat] = useState('BO1');
  const [after, setAfter] = useState('two');
  const [top, setTop] = useState('');
  const [stopAt, setStopAt] = useState('groups_played');
  const [withPlayers, setWithPlayers] = useState(true);
  const [results, setResults] = useState('seeded');
  const [pace, setPace] = useState('live');
  const [seconds, setSeconds] = useState('3');
  const [parallel, setParallel] = useState('4');
  const [formats, setFormats] = useState({ upper: 'BO1', lower: 'BO1', grandFinal: 'BO3' });

  const n = Number(teams) || 0;
  const g = Number(groupCount) || 0;
  const sizes = g ? groupSizes(n, g) : [];
  const topCount = top === '' ? Math.max(1, Math.ceil(Math.min(...sizes, 99) / 2)) : Number(top) || 0;
  const at = (ranks: number[]) => ranks.reduce((sum, r) => sum + sizes.filter((size) => size >= r).length, 0);
  const largest = Math.max(0, ...sizes);
  const brackets =
    after === 'none'
      ? []
      : after === 'one'
        ? [{ name: 'Arbre', n: at(range(1, topCount)) }]
        : [
            { name: 'Élite', n: at(range(1, topCount)) },
            { name: 'Amateur', n: at(range(topCount + 1, largest)) },
          ];
  const invalid = n < 2 || n > 64 ? 'De 2 à 64 équipes.' : !g || n < g * 2 ? `${n} équipes pour ${g} poules : au moins 2 équipes par poule.` : null;

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <p className="text-sm text-muted">
          <Link to="/admin" className="hover:text-white">
            Tableau de bord
          </Link>
        </p>
        <h1 className="text-3xl font-semibold text-white">Sandbox : préparer un tournoi de test</h1>
        <p className="max-w-prose text-sm text-text">
          Crée un faux tournoi (équipes, 5 joueurs par équipe dont un capitaine, pool de maps), le joue avec des résultats factices jusqu'à l'étape choisie,
          puis ouvre son écran de gestion pour tester la suite à la main. C'est un tournoi normal : supprimez-le depuis son écran quand vous avez fini.
        </p>
      </header>

      <form
        className="space-y-5"
        onSubmit={async (e: FormEvent) => {
          e.preventDefault();
          const r = await action.run(pace === 'live' ? 'Tournoi de test lancé : il se joue au fur et à mesure' : 'Tournoi de test prêt', () =>
            api<{ tournamentId: string }>('/sandbox/tournament/prepare', {
              method: 'POST',
              body: JSON.stringify({
                teams: n,
                groupCount: g,
                groupFormat,
                after,
                topPerGroup: top === '' ? undefined : topCount,
                bracketFormats: formats,
                stopAt,
                withPlayers,
                results,
                pace,
                delayMs: Math.round((Number(seconds.replace(',', '.')) || 3) * 1000),
                parallel: Number(parallel) || 4,
              }),
            }),
          );
          if (r?.tournamentId) navigate(tournamentPath(r.tournamentId, 'matchs'));
        }}
      >
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Équipes">
            <Input inputMode="numeric" value={teams} onChange={(e) => setTeams(e.target.value.replace(/\D/g, ''))} className="w-20 font-mono" />
          </Field>
          <Field label="Poules">
            <Input inputMode="numeric" value={groupCount} onChange={(e) => setGroupCount(e.target.value.replace(/\D/g, ''))} className="w-20 font-mono" />
          </Field>
          <Field label="Matchs de poule">
            <Select value={groupFormat} onChange={(e) => setGroupFormat(e.target.value)}>
              <option>BO1</option>
              <option>BO3</option>
            </Select>
          </Field>
          <Field label="Après les poules">
            <Select value={after} onChange={(e) => setAfter(e.target.value)}>
              <option value="two">Élite et Amateur</option>
              <option value="one">un seul arbre</option>
              <option value="none">rien</option>
            </Select>
          </Field>
          {after !== 'none' && (
            <Field label={after === 'two' ? 'En Élite par poule' : 'Qualifiés par poule'}>
              <Input
                inputMode="numeric"
                value={top === '' ? String(topCount) : top}
                onChange={(e) => setTop(e.target.value.replace(/\D/g, ''))}
                className="w-20 font-mono"
              />
            </Field>
          )}
        </div>
        {after !== 'none' && (
          <div className="flex flex-wrap items-end gap-2">
            {(
              [
                ['upper', 'Bracket du haut'],
                ['lower', 'Bracket du bas'],
                ['grandFinal', 'Grande finale'],
              ] as const
            ).map(([key, label]) => (
              <Field key={key} label={label}>
                <Select value={formats[key]} onChange={(e) => setFormats({ ...formats, [key]: e.target.value })}>
                  {key !== 'grandFinal' && <option>BO1</option>}
                  <option>BO3</option>
                  <option>BO5</option>
                </Select>
              </Field>
            ))}
          </div>
        )}
        <div className="flex flex-wrap items-end gap-4">
          <Field label="S'arrêter à">
            <Select value={stopAt} onChange={(e) => setStopAt(e.target.value)}>
              {STEPS.filter((s) => after !== 'none' || !['qualified'].includes(s.value)).map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </Select>
          </Field>
          <label className="flex items-center gap-2 pb-2 text-sm text-text">
            <input type="checkbox" checked={withPlayers} onChange={(e) => setWithPlayers(e.target.checked)} />
            joueurs et stats factices
          </label>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Résultats">
            <Select value={results} onChange={(e) => setResults(e.target.value)}>
              <option value="seeded">logiques (la meilleure tête de série gagne 3 fois sur 4)</option>
              <option value="random">aléatoires (50/50)</option>
            </Select>
          </Field>
          <Field label="Rythme">
            <Select value={pace} onChange={(e) => setPace(e.target.value)}>
              <option value="live">au fur et à mesure (game par game)</option>
              <option value="instant">instantané</option>
            </Select>
          </Field>
          {pace === 'live' && (
            <>
              <Field label="Secondes par game">
                <Input inputMode="decimal" value={seconds} onChange={(e) => setSeconds(e.target.value.replace(/[^\d.,]/g, ''))} className="w-20 font-mono" />
              </Field>
              <Field label="Matchs en même temps">
                <Input inputMode="numeric" value={parallel} onChange={(e) => setParallel(e.target.value.replace(/\D/g, ''))} className="w-20 font-mono" />
              </Field>
            </>
          )}
        </div>
        <p className="max-w-prose text-sm text-muted">
          Scores : le plus souvent 13 à x (matchs serrés plus fréquents), parfois des prolongations (16-14, 19-17).
          {pace === 'live' && " Au fur et à mesure : l'écran du tournoi se met à jour à chaque game, avec Pause / Reprendre / Arrêter en haut."}
        </p>

        {invalid ? (
          <p className="text-sm text-red-light">{invalid}</p>
        ) : (
          <ul className="space-y-1 border-l-2 border-line-strong pl-4 text-sm text-text">
            <li>Poules : {sizes.map((size, i) => `${String.fromCharCode(65 + i)} (${size})`).join(', ')}.</li>
            {brackets.map((b) => (
              <li key={b.name} className={b.n < 2 ? 'text-pause' : ''}>
                {b.name} : {b.n} équipe{b.n > 1 ? 's' : ''}
                {b.n === 2 ? ' (une finale)' : b.n < 2 ? ' : pas assez pour un arbre (cas à tester)' : ''}.
              </li>
            ))}
          </ul>
        )}
        <Button primary type="submit" disabled={action.busy || !!invalid}>
          {action.busy ? 'Préparation…' : 'Préparer le tournoi'}
        </Button>
        <NoticeLine notice={action.notice} />
      </form>
    </div>
  );
}
