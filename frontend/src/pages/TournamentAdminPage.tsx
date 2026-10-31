import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, Navigate, NavLink, Route, Routes, useParams } from 'react-router';
import { api, type Overview, type ServerRow, type TournamentSummary, type TournamentTeam, type VetoConfig, type VetoItem } from '../lib/api';
import { isAdmin, useSession } from '../lib/session';
import { Empty, Section, TOURNAMENT_STATUS } from '../components/live';
import { Button, Input, NoticeLine, Select, useAction } from '../components/ui';
import { NextAction, QualifyStep, StagePlay, StagesSetup } from './tournament/Stages';
import { BonusMatches } from './tournament/BonusMatches';
import { TeamsStep } from './tournament/TeamsStep';
import { VetoSettings, vetoLine } from './tournament/VetoSettings';
import { SimulationBar } from './tournament/SimulationBar';
import { isSettled, stageMatches, tournamentPath } from './tournament/model';

/** Base address of the tournament shown (every link of this screen is absolute, see tournamentPath). */
const useBase = () => tournamentPath(useParams().tournamentId ?? '');

/**
 * Managing one tournament (admins), in steps with their own address (decided with the user: one long page did not
 * say what to do when): Tournoi, Équipes, Véto, Phases (preparation), then Matchs (the LAN day, one tab per stage
 * and one for the bonus matches). The bar says which steps are done; opening a tournament goes to the first one
 * that is not.
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

interface Data {
  summary: TournamentSummary;
  overview: Overview | null;
  teams: TournamentTeam[] | null;
  veto: VetoConfig | null | undefined;
  vetoItems: VetoItem[];
  servers: ServerRow[];
}

interface Step {
  path: string;
  label: string;
  /** done: the step is complete enough to go on (the next ones can still be reopened) */
  done: boolean;
  hint: string;
}

function steps(d: Data): Step[] {
  const teams = d.teams ?? [];
  const stages = d.overview?.stages ?? [];
  const generated = stages.some((s) => s.groups.length > 0 || s.matches.length > 0);
  const noSteam = teams.flatMap((t) => t.players).filter((p) => !p.steamId).length;
  return [
    { path: 'tournoi', label: 'Tournoi', done: true, hint: 'nom et statut' },
    {
      path: 'equipes',
      label: 'Équipes',
      done: teams.length >= 2,
      hint: teams.length < 2 ? 'au moins 2 équipes' : noSteam ? `${noSteam} joueur${noSteam > 1 ? 's' : ''} sans SteamID` : `${teams.length} équipes`,
    },
    { path: 'veto', label: 'Véto', done: !!d.veto, hint: d.veto ? `${d.veto.mapPool.length} maps` : 'pool de maps à choisir' },
    { path: 'phases', label: 'Phases', done: generated, hint: generated ? `${stages.length} phase${stages.length > 1 ? 's' : ''}` : 'créer et générer' },
    { path: 'matchs', label: 'Matchs', done: false, hint: 'le déroulé' },
  ];
}

function TournamentAdmin({ id }: { id: string }) {
  const [data, setData] = useState<Data | null>(null);
  const [missing, setMissing] = useState(false);

  // quiet: an automatic refresh (simulation running) makes no error popup
  const reload = useCallback(
    async (quiet = false) => {
      const list = await api<TournamentSummary[]>('/api/tournament/tournaments', { quiet });
      const summary = list.find((x) => x.id === id);
      if (!summary) return setMissing(true);
      const [overview, teams, veto, vetoItems, servers] = await Promise.all([
        api<Overview>(`/api/tournament/tournaments/${id}/overview`, { quiet }).catch(() => null),
        api<TournamentTeam[]>(`/api/tournament/tournaments/${id}/teams`, { quiet }).catch(() => null),
        // empty answer = no pool yet
        api<VetoConfig | ''>(`/api/tournament/tournaments/${id}/veto`, { quiet })
          .then((c) => c || null)
          .catch(() => null),
        api<VetoItem[]>(`/api/tournament/tournaments/${id}/vetos`, { quiet }).catch(() => []),
        api<ServerRow[]>('/api/tournament/servers', { quiet }).catch(() => []),
      ]);
      setData({ summary, overview, teams, veto, vetoItems, servers });
    },
    [id],
  );
  useEffect(() => {
    reload();
  }, [reload]);

  const base = tournamentPath(id);
  if (missing) return <Empty>Tournoi introuvable.</Empty>;
  if (!data) return null;
  const list = steps(data);
  const first = list.find((s) => !s.done) ?? list[list.length - 1];

  return (
    <div className="space-y-8">
      <header className="space-y-1">
        <Link to="/admin" className="text-sm text-muted hover:text-white">
          Tableau de bord
        </Link>
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <h1 className="text-3xl font-semibold text-white">{data.summary.name}</h1>
          <span className="text-sm text-muted">{TOURNAMENT_STATUS[data.summary.status] ?? data.summary.status}</span>
          <a href={`/view/tournaments/${id}`} className="text-sm text-muted hover:text-white">
            Page publique
          </a>
        </div>
      </header>

      <SimulationBar tournamentId={id} onTick={() => reload(true).catch(() => undefined)} />

      <StepBar steps={list} />

      <Routes>
        <Route index element={<Navigate to={`${base}/${first.path}`} replace />} />
        <Route path="tournoi" element={<InfoStep summary={data.summary} onChange={() => reload()} next={list[1]} />} />
        <Route
          path="equipes"
          element={
            <>
              <TeamsStep tournamentId={id} teams={data.teams} onChange={() => reload()} />
              <NextStep step={list[2]} />
            </>
          }
        />
        <Route path="veto" element={<VetoStep id={id} onChange={() => reload()} next={list[3]} />} />
        <Route path="phases" element={<PhasesStep id={id} data={data} onChange={() => reload()} next={list[4]} />} />
        <Route path="matchs/*" element={<MatchesStep id={id} data={data} onChange={() => reload()} />} />
        <Route path="*" element={<Navigate to={`${base}/${first.path}`} replace />} />
      </Routes>
    </div>
  );
}

/** The steps, in order: number, name, done or what is missing. The current one is underlined in red. */
function StepBar({ steps: list }: { steps: Step[] }) {
  const base = useBase();
  return (
    <nav aria-label="Étapes du tournoi" className="overflow-x-auto border-b border-line">
      <ol className="flex min-w-max">
        {list.map((s, i) => (
          <li key={s.path}>
            <NavLink
              to={`${base}/${s.path}`}
              className={({ isActive }) =>
                `-mb-px flex flex-col border-b-2 px-4 py-2 ${isActive ? 'border-red text-white' : 'border-transparent text-muted hover:text-white'}`
              }
            >
              <span className="text-sm font-semibold">
                <span className="mr-2 font-mono">{i + 1}</span>
                {s.label}
              </span>
              <span className={`text-xs ${s.done ? 'text-ok' : s.path === 'matchs' ? 'text-muted' : 'text-pause'}`}>{s.done ? `fait, ${s.hint}` : s.hint}</span>
            </NavLink>
          </li>
        ))}
      </ol>
    </nav>
  );
}

function NextStep({ step }: { step?: Step }) {
  const base = useBase();
  if (!step) return null;
  return (
    <div className="border-t border-line pt-6">
      <Link to={`${base}/${step.path}`} className="inline-block bg-red px-4 py-2 text-sm font-semibold text-white hover:bg-red-light">
        Étape suivante : {step.label}
      </Link>
    </div>
  );
}

// --- 1. Tournoi -------------------------------------------------------------------------------------------------

function InfoStep({ summary, onChange, next }: { summary: TournamentSummary; onChange: () => void; next: Step }) {
  const [name, setName] = useState(summary.name);
  const { busy, notice, run } = useAction(onChange);
  const patch = (label: string, body: object) =>
    run(label, () => api(`/api/tournament/tournaments/${summary.id}`, { method: 'PATCH', body: JSON.stringify(body) }));
  return (
    <>
      <Section title="Tournoi">
        <div className="space-y-4">
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              patch('Tournoi renommé', { name });
            }}
          >
            <label className="flex flex-col gap-1 text-sm text-muted">
              Nom
              <Input value={name} onChange={(e) => setName(e.target.value)} className="sm:w-96" />
            </label>
            <Button type="submit" disabled={busy || !name.trim() || name === summary.name}>
              Renommer
            </Button>
          </form>
          <label className="flex flex-col gap-1 text-sm text-muted">
            Statut (archivé : caché de l'accueil)
            <Select value={summary.status} disabled={busy} onChange={(e) => patch('Statut changé', { status: e.target.value })} className="w-48">
              {Object.entries(TOURNAMENT_STATUS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </label>
          <NoticeLine notice={notice} />
        </div>
      </Section>
      <NextStep step={next} />
    </>
  );
}

// --- 3. Véto ----------------------------------------------------------------------------------------------------

function VetoStep({ id, onChange, next }: { id: string; onChange: () => void; next: Step }) {
  const action = useAction(onChange);
  return (
    <>
      <Section title="Véto">
        <div className="space-y-3">
          <p className="max-w-prose text-sm text-text">
            Les maps entre lesquelles les capitaines bannissent et choisissent, et la façon de décider des camps. Sans pool de maps, aucun véto ne peut
            commencer.
          </p>
          <VetoSettings tournamentId={id} action={action} />
          <NoticeLine notice={action.notice} />
        </div>
      </Section>
      <NextStep step={next} />
    </>
  );
}

// --- 4. Phases --------------------------------------------------------------------------------------------------

function PhasesStep({ id, data, onChange, next }: { id: string; data: Data; onChange: () => void; next: Step }) {
  const action = useAction(onChange);
  return (
    <>
      <Section title="Phases">
        <div className="space-y-4">
          <p className="max-w-prose text-sm text-text">
            Créez les phases dans leur ordre (par exemple Poules, puis Élite et Amateur en double élimination), puis générez les poules. Après les poules, la
            qualification (onglet Qualification des matchs) envoie les équipes dans les arbres et les génère (2 équipes : une finale).
          </p>
          <NoticeLine notice={action.notice} />
          {data.overview && <StagesSetup tournamentId={id} stages={data.overview.stages} teams={data.teams ?? []} action={action} />}
        </div>
      </Section>
      <NextStep step={next} />
    </>
  );
}

// --- 5. Matchs --------------------------------------------------------------------------------------------------

/** One tab per stage, plus the bonus matches; opens on the first stage with a match still to play. */
function MatchesStep({ id, data, onChange }: { id: string; data: Data; onChange: () => void }) {
  const action = useAction(onChange);
  const stages = data.overview?.stages ?? [];
  const teams = data.teams ?? [];
  const names = Object.fromEntries(teams.map((t) => [t.id, t.name]));
  const vetos = Object.fromEntries(data.vetoItems.map((v) => [v.matchId, vetoLine(v, names)]));
  const start = stages.find((s) => stageMatches(s).some((m) => !isSettled(m))) ?? stages[0];
  // a group stage followed by other stages gets its "Qualification" tab right after it (its own screen)
  const tabs: { key: string; label: string }[] = [
    ...stages.flatMap((s) => [
      { key: s.id, label: s.name },
      ...(s.type === 'ROUND_ROBIN' && s.groups.length > 0 && stages.some((x) => x.order > s.order)
        ? [{ key: `qualification-${s.id}`, label: 'Qualification' }]
        : []),
    ]),
    { key: 'bonus', label: 'Matchs bonus' },
  ];

  const body = (key: string): ReactNode => {
    if (key === 'bonus') {
      return <BonusMatches tournamentId={id} matches={data.overview?.bonusMatches ?? []} teams={teams} servers={data.servers} action={action} vetos={vetos} />;
    }
    if (key.startsWith('qualification-')) {
      const groups = stages.find((s) => s.id === key.slice('qualification-'.length));
      return groups ? <QualifyStep stage={groups} stages={stages} action={action} /> : <Empty>Phase introuvable.</Empty>;
    }
    const stage = stages.find((s) => s.id === key);
    if (!stage) return <Empty>Phase introuvable.</Empty>;
    return <StagePlay stage={stage} stages={stages} teams={teams} servers={data.servers} action={action} vetos={vetos} />;
  };

  return (
    <div className="space-y-6">
      <NextAction tournamentId={id} stages={stages} />
      <nav aria-label="Phases" className="flex flex-wrap gap-2">
        {tabs.map((t) => (
          <NavLink
            key={t.key}
            to={tournamentPath(id, `matchs/${t.key}`)}
            className={({ isActive }) => `border px-3 py-1.5 text-sm ${isActive ? 'border-text text-white' : 'border-line-strong text-muted hover:text-white'}`}
          >
            {t.label}
          </NavLink>
        ))}
      </nav>
      <NoticeLine notice={action.notice} />
      <Routes>
        <Route index element={<Navigate to={tournamentPath(id, `matchs/${start ? start.id : 'bonus'}`)} replace />} />
        {tabs.map((t) => (
          <Route key={t.key} path={t.key} element={body(t.key)} />
        ))}
        <Route path="*" element={<Empty>Phase introuvable.</Empty>} />
      </Routes>
    </div>
  );
}
