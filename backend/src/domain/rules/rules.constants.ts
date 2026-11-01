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
  /** Argent maximum autorisé par joueur dans CS2 */
  DEFAULT_MAX_CASH: 16000,
  /** Argent de départ en prolongation (Valve standard) */
  DEFAULT_OT_START_MONEY: 10000,
  /** Nombre total de rounds par cycle de prolongation (MR3 -> 6 rounds) */
  DEFAULT_OT_MAX_ROUNDS: 6,
  /** Carte par défaut pour les serveurs et le sandbox */
  DEFAULT_MAP: 'de_inferno',
  /** Base offset 64-bit de SteamID Valve */
  STEAMID64_BASE: 76561197960265728n,
} as const;

/** Banque de pause tactique par équipe (secondes), source unique : init du match, débit, affichage, snapshot. */
export const DEFAULT_TAC_BANK_SEC = CS2_RULES.DEFAULT_TACTICAL_TIMEOUTS * CS2_RULES.DEFAULT_TACTICAL_TIMEOUT_SEC;

/**
 * Noms standardisés des fichiers de configuration CS2 natifs.
 */
export const CS2_CFG = {
  WARMUP: 'warmup.cfg',
  COMPETITIVE: 'gamemode_competitive.cfg',
  COMPETITIVE_TMM: 'gamemode_competitive_tmm.cfg',
  KNIFE: 'knife.cfg',
  KNIFE_UNDO: 'knife_undo.cfg',
  OVERTIME: 'overtime.cfg',
} as const;

/**
 * Commandes RCON CS2 standardisées (anti-hallucination / zéro plugin).
 */
export const CS2_RCON_COMMANDS = {
  SWAP_TEAMS: 'mp_swapteams',
  UNPAUSE_MATCH: 'mp_unpause_match; unpause',
  UNPAUSE: 'mp_unpause_match',
  WARMUP_START: 'mp_warmup_start 1',
  WARMUP_END: 'mp_warmup_end 1',
  // warmup.cfg / knife.cfg / overtime.cfg live in agent/cfg/ggbot, NOT on the server: a raw RCON
  // "exec <cfg>" fails there. Apply them with orch.execCfg / cmds.exec (agent exec_cfg), never here.
  WARMUP_INFINITE: 'mp_warmup_start 1; mp_warmuptime 999999; mp_warmup_pausetimer 1',
  WARMUP_SANDBOX: 'mp_warmup_start 1; mp_warmuptime 999999; mp_warmup_pausetimer 1; bot_quota 2; bot_quota_mode fill; mp_unpause_match',
  COMPETITIVE_START: `exec ${CS2_CFG.COMPETITIVE}; exec ${CS2_CFG.COMPETITIVE_TMM}; mp_warmup_end 1`,
  RESTORE_PREPARE: 'mp_backup_restore_load_autopause 0; mp_overtime_enable 1; mp_overtime_maxrounds 6; mp_overtime_startmoney 10000; bot_quota 2; bot_quota_mode fill; bot_join_after_player 1; mp_warmup_end',
  RESTORE_LOAD: (file: string) => `mp_backup_restore_load_file ${file}`,
  BOT_BALANCE_CT: 'bot_kick ct; bot_add_t; mp_unpause_match',
  BOT_BALANCE_T: 'bot_kick t; bot_add_ct; mp_unpause_match',
  CHANGELEVEL: (map: string) => `changelevel ${map}`,
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

/**
 * Normalise une commande textuelle in-game en retirant d'éventuels préfixes (!, .) et espaces
 * Ex: "!ready" -> "ready", ".stay" -> "stay", "READY" -> "ready"
 */
export function normalizeChatCommand(cmd: string | null | undefined): string {
  if (!cmd) return '';
  const trimmed = cmd.trim().toLowerCase();
  return trimmed.startsWith('!') || trimmed.startsWith('.') ? trimmed.slice(1) : trimmed;
}
