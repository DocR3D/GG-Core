// src/domain/rules/rules.constants.ts

/**
 * Constantes de règles compétitives CS2 (Règlement officiel Valve Major / LAN).
 */
export const CS2_RULES = {
  /** Nombre de rounds par demi-temps en régulation MR12 */
  DEFAULT_MR_HALF: 12,
  /** Nombre de rounds pour remporter la victoire en temps réglementaire MR12 */
  DEFAULT_REGULATION_WIN: 13,
  /** Nombre de rounds par demi-temps en prolongation MR3 */
  DEFAULT_OT_HALF: 3,
  /** Écart de rounds requis pour valider une victoire en prolongation */
  DEFAULT_OT_WIN_MARGIN: 2,
  /** Délai en secondes du redémarrage rapide de manche (Fast LAN mode) */
  FAST_RESTART_DELAY_SEC: 3,
  /** Délai en secondes du compte à rebours avant passage en phase Live */
  COUNTDOWN_DELAY_SEC: 5,
  /** Nombre par défaut de pauses tactiques par équipe */
  DEFAULT_TACTICAL_TIMEOUTS: 4,
  /** Durée en secondes par défaut d'une pause tactique */
  DEFAULT_TACTICAL_TIMEOUT_SEC: 30,
} as const;

/**
 * Noms standardisés des fichiers de configuration CS2 natifs.
 */
export const CS2_CFG = {
  WARMUP: 'warmup.cfg',
  COMPETITIVE: 'gamemode_competitive.cfg',
  COMPETITIVE_TMM: 'gamemode_competitive_tmm',
  KNIFE: 'ggbot/knife.cfg',
  KNIFE_UNDO: 'ggbot/knife_undo.cfg',
  OVERTIME: 'overtime.cfg',
} as const;

/**
 * Commandes textuelles in-game reconnues par GG-Core.
 */
export const CS2_CHAT_COMMANDS = {
  READY: 'ready',
  NOTREADY: 'notready',
  UNREADY: 'unready',
  PAUSE: 'pause',
  UNPAUSE: 'unpause',
  TECH: 'tech',
  STAY: 'stay',
  SWITCH: 'switch',
  SWAP: 'swap',
  INIT: 'init',
} as const;
