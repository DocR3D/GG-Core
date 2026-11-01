import { useState, type FormEvent } from 'react';
import { api, type TournamentTeam } from '../../lib/api';
import { Empty, Section } from '../../components/live';
import { Button, Field, Input, NoticeLine, useAction, type Action } from '../../components/ui';

// --- Teams and players ----------------------------------------------------------------------------------------

/** Step 2: the teams and their players (SteamID: the whitelist; captain: rock-paper-scissors and veto). */
export function TeamsStep({ tournamentId, teams, onChange }: { tournamentId: string; teams: TournamentTeam[] | null; onChange: () => void }) {
  const action = useAction(onChange);
  return (
    <Section title="Équipes" count={teams?.length}>
      <div className="space-y-6">
        <NewTeam tournamentId={tournamentId} action={action} />
        <NoticeLine notice={action.notice} />
        {teams && teams.length === 0 && <Empty>Aucune équipe : ajoutez-en une avec son premier joueur.</Empty>}
        {teams?.map((t) => (
          <TeamBlock key={t.id} tournamentId={tournamentId} team={t} action={action} />
        ))}
      </div>
    </Section>
  );
}

/** A team only belongs to a tournament through its players (or its matches): created with its first player. */
function NewTeam({ tournamentId, action }: { tournamentId: string; action: Action }) {
  const [name, setName] = useState('');
  const [player, setPlayer] = useState('');
  const [steamId, setSteamId] = useState('');
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={async (e: FormEvent) => {
        e.preventDefault();
        const done = await action.run(`Équipe ${name.trim()} ajoutée`, async () => {
          const [team] = await api<{ id: string }[]>('/api/tournament/teams', { method: 'POST', body: JSON.stringify({ names: [name.trim()] }) });
          await api(`/api/tournament/tournaments/${tournamentId}/teams/${team.id}/players`, {
            method: 'POST',
            body: JSON.stringify({ players: [{ username: player.trim(), steamId: steamId.trim() || undefined, captain: true }] }),
          });
          return true;
        });
        if (done) {
          setName('');
          setPlayer('');
          setSteamId('');
        }
      }}
    >
      <Field label="Nouvelle équipe">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nom de l'équipe" />
      </Field>
      <Field label="Capitaine">
        <Input value={player} onChange={(e) => setPlayer(e.target.value)} placeholder="Pseudo" />
      </Field>
      <Field label="SteamID du capitaine">
        <Input value={steamId} onChange={(e) => setSteamId(e.target.value)} placeholder="7656… ou [U:1:…]" className="font-mono" />
      </Field>
      <Button primary type="submit" disabled={action.busy || !name.trim() || !player.trim()}>
        Ajouter l'équipe
      </Button>
    </form>
  );
}

function TeamBlock({ tournamentId, team, action }: { tournamentId: string; team: TournamentTeam; action: Action }) {
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(team.name);
  const [confirmRemove, setConfirmRemove] = useState(false);
  return (
    <div className="border-t border-line pt-4">
      <div className="flex flex-wrap items-center gap-3">
        {renaming ? (
          <form
            className="flex flex-wrap gap-2"
            onSubmit={async (e: FormEvent) => {
              e.preventDefault();
              if (await action.run('Équipe renommée', () => api(`/api/tournament/teams/${team.id}`, { method: 'PATCH', body: JSON.stringify({ name }) })))
                setRenaming(false);
            }}
          >
            <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
            <Button small primary type="submit" disabled={action.busy || !name.trim()}>
              Renommer
            </Button>
            <Button small onClick={() => setRenaming(false)}>
              Annuler
            </Button>
          </form>
        ) : (
          <>
            <h3 className="text-lg font-semibold text-white">{team.name}</h3>
            <Button small onClick={() => setRenaming(true)}>
              Renommer
            </Button>
          </>
        )}
        {confirmRemove ? (
          <span className="flex items-center gap-2 text-sm">
            Retirer {team.name} du tournoi ?
            <Button
              small
              danger
              disabled={action.busy}
              onClick={() =>
                action.run(`${team.name} retirée`, () => api(`/api/tournament/tournaments/${tournamentId}/teams/${team.id}`, { method: 'DELETE' }))
              }
            >
              Retirer
            </Button>
            <Button small onClick={() => setConfirmRemove(false)}>
              Annuler
            </Button>
          </span>
        ) : (
          <Button small danger onClick={() => setConfirmRemove(true)}>
            Retirer l'équipe
          </Button>
        )}
      </div>
      <ul className="mt-2 divide-y divide-line">
        {team.players.map((p) => (
          <PlayerLine key={p.id} tournamentId={tournamentId} teamId={team.id} player={p} action={action} />
        ))}
      </ul>
      <AddPlayer tournamentId={tournamentId} teamId={team.id} action={action} />
    </div>
  );
}

function PlayerLine({
  tournamentId,
  teamId,
  player,
  action,
}: {
  tournamentId: string;
  teamId: string;
  player: TournamentTeam['players'][number];
  action: Action;
}) {
  const [editing, setEditing] = useState(false);
  const [username, setUsername] = useState(player.username);
  const [steamId, setSteamId] = useState(player.steamId ?? '');
  if (editing) {
    return (
      <li className="py-2">
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={async (e: FormEvent) => {
            e.preventDefault();
            const ok = await action.run(`${username} modifié`, () =>
              api(`/api/tournament/players/${player.id}`, { method: 'PATCH', body: JSON.stringify({ username, steamId }) }),
            );
            if (ok) setEditing(false);
          }}
        >
          <Input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Pseudo" autoFocus />
          <Input value={steamId} onChange={(e) => setSteamId(e.target.value)} placeholder="SteamID (vide = aucun)" className="font-mono" />
          <Button small primary type="submit" disabled={action.busy || !username.trim()}>
            Enregistrer
          </Button>
          <Button small onClick={() => setEditing(false)}>
            Annuler
          </Button>
        </form>
      </li>
    );
  }
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2">
      <span className="min-w-32 text-white">{player.username}</span>
      <span className={`min-w-44 font-mono text-sm ${player.steamId ? 'text-muted' : 'text-pause'}`}>{player.steamId ?? 'pas de SteamID'}</span>
      {player.captain ? <span className="text-sm text-text">capitaine</span> : null}
      <span className="ml-auto flex gap-2">
        {!player.captain && (
          <Button
            small
            disabled={action.busy}
            onClick={() =>
              action.run(`${player.username} capitaine`, () =>
                api(`/api/tournament/tournaments/${tournamentId}/teams/${teamId}/captain`, { method: 'PUT', body: JSON.stringify({ playerId: player.id }) }),
              )
            }
          >
            Nommer capitaine
          </Button>
        )}
        <Button small onClick={() => setEditing(true)}>
          Modifier
        </Button>
        <Button
          small
          danger
          disabled={action.busy}
          onClick={() =>
            action.run(`${player.username} retiré`, () =>
              api(`/api/tournament/tournaments/${tournamentId}/teams/${teamId}/players/${player.id}`, { method: 'DELETE' }),
            )
          }
        >
          Retirer
        </Button>
      </span>
    </li>
  );
}

function AddPlayer({ tournamentId, teamId, action }: { tournamentId: string; teamId: string; action: Action }) {
  const [username, setUsername] = useState('');
  const [steamId, setSteamId] = useState('');
  return (
    <form
      className="mt-2 flex flex-wrap items-center gap-2"
      onSubmit={async (e: FormEvent) => {
        e.preventDefault();
        const ok = await action.run(`${username.trim()} ajouté`, () =>
          api(`/api/tournament/tournaments/${tournamentId}/teams/${teamId}/players`, {
            method: 'POST',
            body: JSON.stringify({ players: [{ username: username.trim(), steamId: steamId.trim() || undefined }] }),
          }),
        );
        if (ok) {
          setUsername('');
          setSteamId('');
        }
      }}
    >
      <Input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Pseudo" />
      <Input value={steamId} onChange={(e) => setSteamId(e.target.value)} placeholder="SteamID" className="font-mono" />
      <Button small type="submit" disabled={action.busy || !username.trim()}>
        Ajouter un joueur
      </Button>
    </form>
  );
}
