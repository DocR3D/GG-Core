// src/application/tournaments/tournament.mapper.ts
//
// Transforme le payload brut de l'API externe vers le modèle simplifié.
// Pur (sans effets de bord) — facile à tester unitairement.

import type {
  ApiTournament, ApiTeam, ApiUser,
  Tournament, Team, Player, SyncResult,
} from './tournament.types';

// -----------------------------------------------------------------------
// Player
// -----------------------------------------------------------------------

function mapPlayer(user: ApiUser): Player {
  return {
    id:        user.id,
    name:      user.pseudo ?? '',
    isCaptain: (user.pivot?.captain ?? 0) === 1,
  };
}

// -----------------------------------------------------------------------
// Team
// -----------------------------------------------------------------------

function mapTeam(team: ApiTeam): Team {
  return {
    id:      team.id,
    name:    team.name ?? '',
    players: (team.users ?? []).map(mapPlayer),
  };
}

// -----------------------------------------------------------------------
// Tournament (type=team uniquement)
// -----------------------------------------------------------------------

function mapTournament(t: ApiTournament): Tournament {
  const team_ids = (t.teams ?? []).map(team => team.id);
  return {
    id:         t.id,
    name:       t.name ?? '',
    game:       t.game_id,
    status:     t.status ?? 'unknown',
    start_date: t.start_date ?? '',
    end_date:   t.end_date ?? '',
    team_ids,
  };
}

// -----------------------------------------------------------------------
// Point d'entrée : transforme toute la liste
// -----------------------------------------------------------------------

export function mapApiResponse(raw: ApiTournament[]): SyncResult {
  // On traite uniquement les tournois type=team
  const teamTournaments = (raw ?? []).filter(t => t.type === 'team');

  const tournaments: Tournament[] = teamTournaments.map(mapTournament);

  // Déduplique les teams par id (une même équipe pourrait théoriquement
  // apparaître dans plusieurs tournois — on garde la dernière version)
  const teamsMap = new Map<number, Team>();
  for (const t of teamTournaments) {
    for (const team of t.teams ?? []) {
      teamsMap.set(team.id, mapTeam(team));
    }
  }

  return { tournaments, teams: [...teamsMap.values()] };
}
