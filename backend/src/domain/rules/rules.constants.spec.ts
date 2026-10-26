// src/domain/rules/rules.constants.spec.ts
import { CS2_CFG, CS2_RULES, CS2_CHAT_COMMANDS, CS2_RCON_COMMANDS, normalizeChatCommand } from './rules.constants';

describe('CS2_CFG & CS2_RULES — Standards Valve CS2', () => {
  it('doit pointer vers les fichiers cfg CS2 natifs à la racine de cfg/', () => {
    // Évite l'erreur "couldn't exec '{*}cfg/ggbot/knife.cfg', unable to read file"
    expect(CS2_CFG.KNIFE).toBe('knife.cfg');
    expect(CS2_CFG.KNIFE_UNDO).toBe('knife_undo.cfg');
    expect(CS2_CFG.WARMUP).toBe('warmup.cfg');
    expect(CS2_CFG.OVERTIME).toBe('overtime.cfg');
    expect(CS2_CFG.COMPETITIVE).toBe('gamemode_competitive.cfg');
    expect(CS2_CFG.COMPETITIVE_TMM).toBe('gamemode_competitive_tmm.cfg');
  });

  it('doit définir les règles de compétition MR12 et Overtime MR3 officielles', () => {
    expect(CS2_RULES.DEFAULT_MR_HALF).toBe(12);
    expect(CS2_RULES.DEFAULT_REGULATION_WIN).toBe(13);
    expect(CS2_RULES.DEFAULT_OT_HALF).toBe(3);
    expect(CS2_RULES.DEFAULT_OT_WIN_MARGIN).toBe(2);
    expect(CS2_RULES.FAST_RESTART_DELAY_SEC).toBe(3);
    expect(CS2_RULES.COUNTDOWN_DELAY_SEC).toBe(5);
    expect(CS2_RULES.DEFAULT_MAX_CASH).toBe(16000);
    expect(CS2_RULES.DEFAULT_OT_START_MONEY).toBe(10000);
    expect(CS2_RULES.DEFAULT_OT_MAX_ROUNDS).toBe(6);
    expect(CS2_RULES.DEFAULT_MAP).toBe('de_inferno');
    expect(CS2_RULES.STEAMID64_BASE).toBe(76561197960265728n);
  });

  it('doit définir les commandes RCON standardisées CS2', () => {
    expect(CS2_RCON_COMMANDS.SWAP_TEAMS).toBe('mp_swapteams');
    expect(CS2_RCON_COMMANDS.UNPAUSE_MATCH).toBe('mp_unpause_match; unpause');
    expect(CS2_RCON_COMMANDS.UNPAUSE).toBe('mp_unpause_match');
    expect(CS2_RCON_COMMANDS.COMPETITIVE_START).toContain('gamemode_competitive.cfg');
    expect(CS2_RCON_COMMANDS.KNIFE_START).toBe('exec knife.cfg');
    expect(CS2_RCON_COMMANDS.OVERTIME_START).toBe('exec overtime.cfg');
    expect(CS2_RCON_COMMANDS.CHANGELEVEL('de_mirage')).toBe('changelevel de_mirage');
    expect(CS2_RCON_COMMANDS.RESTORE_LOAD('round1.txt')).toBe('mp_backup_restore_load_file round1.txt');
  });

  it('doit contenir les commandes textuelles reconnues sans préfixe', () => {
    expect(CS2_CHAT_COMMANDS.READY).toBe('ready');
    expect(CS2_CHAT_COMMANDS.NOTREADY).toBe('notready');
    expect(CS2_CHAT_COMMANDS.UNREADY).toBe('unready');
    expect(CS2_CHAT_COMMANDS.STAY).toBe('stay');
    expect(CS2_CHAT_COMMANDS.SWITCH).toBe('switch');
    expect(CS2_CHAT_COMMANDS.PAUSE).toBe('pause');
    expect(CS2_CHAT_COMMANDS.UNPAUSE).toBe('unpause');
  });

  it('normalizeChatCommand doit retirer les préfixes (!, .) et uniformiser en minuscules', () => {
    expect(normalizeChatCommand('!ready')).toBe('ready');
    expect(normalizeChatCommand('.ready')).toBe('ready');
    expect(normalizeChatCommand('ready')).toBe('ready');
    expect(normalizeChatCommand('!STAY ')).toBe('stay');
    expect(normalizeChatCommand('')).toBe('');
    expect(normalizeChatCommand(null)).toBe('');
    expect(normalizeChatCommand(undefined)).toBe('');
  });
});
