// src/domain/rules/rules.constants.spec.ts
import { CS2_CFG, CS2_RULES, CS2_CHAT_COMMANDS } from './rules.constants';

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
});
