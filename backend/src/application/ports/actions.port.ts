// application/ports/actions.port.ts

import { MatchPhase } from "@domain/phase.types";

export const ACTIONS_PORT = Symbol('ACTIONS_PORT');

/**
 * Port abstrait utilisé par les règles et services de phase
 * pour demander des actions côté agent.
 * 
 * Implémenté par MatchCommandsService.
 */
export interface ActionsPort {
  /**
   * Relancer la map (changelevel/restart).
   */
  restart(opts: { serverId?: string; matchId?: string; delay?: number }): Promise<void>;

  /**
   * Exécuter un fichier de configuration côté serveur (exec cfg).
   */
  exec(opts: { serverId?: string; matchId?: string; cfgName: string; vars?: Record<string, string> }): Promise<void>;

  /**
   * Envoyer un message dans le chat serveur.
   */
  say(opts: { serverId: string; message: string; channel?: 'say' | 'say_team' }): Promise<void>;

  /**
   * Déclencher un timeout tactique (par équipe).
   */
  tacTimeout(opts: { serverId: string; matchId: string; teamSide: 'CT' | 'T'; teamLogical: 'home' | 'away'; seconds: number }): Promise<void>;

  /**
   * Déclencher un timeout technique (global).
   */
  techTimeout(opts: { serverId: string; matchId: string; seconds: number }): Promise<void>;

  /**
   * Forcer un swap des sides CT/T.
   */
  swapSides(opts: { matchId: string }): Promise<void>;

  /**
   * Démarrer un match en live après le knife.
   */
  startLive(opts: { matchId: string }): Promise<void>;

  startPhaseCountdown(matchId: string, nextPhase: MatchPhase, seconds: number, serverId?: string): Promise<void>;
}
