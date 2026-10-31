import { useState, type FormEvent } from 'react';
import { api, type OverviewMatch, type ServerRow, type TournamentTeam } from '../../lib/api';
import { Empty } from '../../components/live';
import { Button, Field, Select, type Action } from '../../components/ui';
import { MatchRow } from './MatchRow';
import type { VetoLine } from './model';

/** Matches outside the stages: the form to add one, then the list with their operations. */
export function BonusMatches({
  tournamentId,
  matches,
  teams,
  servers,
  action,
  vetos,
}: {
  tournamentId: string;
  matches: OverviewMatch[];
  teams: TournamentTeam[];
  servers: ServerRow[];
  action: Action;
  vetos: Record<string, VetoLine>;
}) {
  return (
    <div className="space-y-4">
      <BonusMatch tournamentId={tournamentId} teams={teams} action={action} />
      {matches.length === 0 && <Empty>Aucun match bonus.</Empty>}
      {matches.length > 0 && (
        <ul className="divide-y divide-line border-y border-line">
          {matches.map((m) => (
            <MatchRow key={m.id} match={m} servers={servers} teams={teams} action={action} bonus veto={vetos[m.id]} />
          ))}
        </ul>
      )}
    </div>
  );
}

/** A match outside the stages: for fun, or to settle a place (later). */
function BonusMatch({ tournamentId, teams, action }: { tournamentId: string; teams: TournamentTeam[]; action: Action }) {
  const [home, setHome] = useState('');
  const [away, setAway] = useState('');
  const [format, setFormat] = useState('BO1');
  if (teams.length < 2) return <Empty>Ajoutez au moins deux équipes pour créer un match bonus.</Empty>;
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        action.run('Match bonus ajouté', () =>
          api(`/api/tournament/tournaments/${tournamentId}/bonus-matches`, {
            method: 'POST',
            body: JSON.stringify({ homeTeamId: home, awayTeamId: away, format }),
          }),
        );
      }}
    >
      <Field label="Nouveau match bonus">
        <Select value={home} onChange={(e) => setHome(e.target.value)}>
          <option value="">Équipe 1</option>
          {teams.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="contre">
        <Select value={away} onChange={(e) => setAway(e.target.value)}>
          <option value="">Équipe 2</option>
          {teams.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Format">
        <Select value={format} onChange={(e) => setFormat(e.target.value)}>
          <option>BO1</option>
          <option>BO3</option>
          <option>BO5</option>
        </Select>
      </Field>
      <Button type="submit" disabled={action.busy || !home || !away || home === away}>
        Ajouter le match
      </Button>
    </form>
  );
}
