// src/application/tournaments/tournament.types.ts

// ============================================================
// Source — modèle brut retourné par l'API externe
// ============================================================

export type ApiPivot = {
  team_id: number;
  user_id: number;
  captain: 0 | 1;
};

export type ApiUser = {
  id: number;
  pseudo: string;
  image: string | null;
  pivot?: ApiPivot;
  created_at: string | null;
  updated_at: string | null;
};

export type ApiTeam = {
  id: number;
  name: string;
  description: string | null;
  image: string | null;
  tournament_id: number;
  registration_state: string;
  captain_id: number | null;
  captain: ApiUser | null;
  users: ApiUser[];
};

export type ApiTournament = {
  id: number;
  name: string;
  description: string | null;
  start_date: string;
  end_date: string;
  game_id: number;
  status: string;
  type: 'team' | 'solo';
  teams?: ApiTeam[];
  players?: ApiUser[];
};

export type ApiResponse = {
  status: 'success' | 'error';
  message: string;
  data: ApiTournament[];
};

// ============================================================
// Cible — modèle simplifié stocké en cache / exposé par l'API
// ============================================================

export type Player = {
  id: number;
  name: string;
  isCaptain: boolean;
};

export type Team = {
  id: number;
  name: string;
  players: Player[];
};

export type Tournament = {
  id: number;
  name: string;
  game: number;
  status: string;
  start_date: string;
  end_date: string;
  team_ids: number[];
};

export type SyncResult = {
  tournaments: Tournament[];
  teams: Team[];
};
