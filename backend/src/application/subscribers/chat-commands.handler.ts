// src/application/subscribers/chat-commands.handler.ts
import { Injectable, Logger } from '@nestjs/common';
import { RuleContextFactory } from '@domain/rules/rule-context-factory';
import { RuleRegistry } from '@app/rules/rule.registry';
import { MatchPhaseService } from '@app/phase/match-phase.service';
import { MatchCommandsService } from '@app/commands/match-commands.service';
import { MatchPhase } from '@domain/phase.types';
import type { CommandEvent } from '@domain/types/command.event';

type GameSide = 'CT' | 'T' | 'SPECTATOR';
type Channel  = 'say' | 'say_team';

const CMD_COOLDOWN_MS = 800; // garde ta valeur

@Injectable()
export class ChatCommandHandler {
  private readonly logger = new Logger(ChatCommandHandler.name);
  private lastByPlayer = new Map<string, number>();

  constructor(
    private readonly registry: RuleRegistry,
    private readonly ctxFactory: RuleContextFactory,
    private readonly phase: MatchPhaseService,
    private readonly matchCmds: MatchCommandsService,
  ) {}

  private key(matchId: string, who: string) { return `${matchId}::${who}`; }
  private normChan(c?: string): Channel { return c === 'say_team' ? 'say_team' : 'say'; }

  // ===== Registre de commandes "globales" (indépendantes de la phase) =====
  private global = new Map<string, (ev: CommandEvent) => Promise<void>>();

  // init paresseux du registre pour éviter de binder 20x
  private ensureGlobalInit() {
    if (this.global.size) return;

    const actor = (ev: CommandEvent) => ({
      name: ev.payload.sender.name,
      steamId: ev.payload.sender.steamId ?? undefined,
      teamSide: ev.payload.sender.team as GameSide,
      channel: this.normChan(ev.payload.sender.channel),
    });

    // init avancé (map / sides) – tu gardes ta logique telle quelle
    this.global.set('init', async (ev) => {
      const p = ev.payload.parameters ?? [];
      const toSide = (s?: string): 'CT'|'T'|undefined => {
        if (!s) return undefined;
        const u = s.toUpperCase();
        if (u === 'CT') return 'CT';
        if (u === 'T' || u === 'TERRORIST') return 'T';
        return undefined;
      };

      let matchIdParam: string | undefined;
      let map: string | undefined;
      let home: 'CT'|'T' = 'CT';
      let away: 'CT'|'T' = 'T';

      if (p.length >= 4) {
        matchIdParam = p[0]; map = p[1];
        home = toSide(p[2]) ?? 'CT';
        away = toSide(p[3]) ?? (home === 'CT' ? 'T' : 'CT');
      } else if (p.length === 3) {
        map = p[0];
        home = toSide(p[1]) ?? 'CT';
        away = toSide(p[2]) ?? 'T';
      } else if (p.length === 2) {
        home = toSide(p[0]) ?? 'CT';
        away = toSide(p[1]) ?? 'T';
      }

      await this.matchCmds.ensureInitMatch(
        ev.serverId,
        matchIdParam ?? ev.matchId ?? undefined,
        { home, away },
        { map }
      );

      if (map) await this.matchCmds.changeLevel({ serverId: ev.serverId, map });
    });
  }

  // ================================ ENTRYPOINT ==============================
  async handle(ev: CommandEvent): Promise<void> {
    // 0) sanity checks
    if (!ev?.matchId) {
      this.logger.warn(`[COMMAND] ignored: missing matchId (serverId=${ev?.serverId ?? '∅'})`);
      return;
    }
    if ((ev as any).kind && (ev as any).kind !== 'primary') return;

    const sender = ev.payload?.sender;
    const command = (ev.payload?.command || '').toLowerCase();
    const params  = ev.payload?.parameters ?? [];
    if (!sender || !command) {
      this.logger.warn('[COMMAND] ignored: bad payload');
      return;
    }

    const side  = sender.team as GameSide;
    const chan  = this.normChan(sender.channel);
    const who   = sender.steamId ?? sender.name ?? 'unknown';

    // 1) anti-spam (cooldown par joueur/match)
    const k = this.key(ev.matchId, who);
    const now = Date.now();
    const last = this.lastByPlayer.get(k) ?? 0;
    if (now - last < CMD_COOLDOWN_MS) {
      this.logger.debug(`[COMMAND] spam filtered ${who} Δ=${now-last}ms cmd="${command}"`);
      return;
    }
    this.lastByPlayer.set(k, now);

    // 2) guard spectateur
    if (side === 'SPECTATOR' && command !== 'init') {
      this.logger.debug(`[COMMAND] ignored from spectator: ${who} cmd=${command}`);
      return;
    }

    // 3) debug log
    this.logger.debug(`[COMMAND] ${command} by=${who} team=${side} chan=${chan} params=${JSON.stringify(params)} match=${ev.matchId}`);

    // 4) déléguer à la rule active si elle gère la commande
    const phase = await this.phase.getPhase(ev.matchId);
    const rule  = this.registry.getRule(phase);

    if (rule.canHandleCommand?.(command)) {
      const ctx = this.ctxFactory.make({ matchId: ev.matchId, serverId: ev.serverId });
      await rule.handleCommand!(ev, ctx);
      return;
    }

    // 5) sinon: commandes globales
    this.ensureGlobalInit();
    const fn = this.global.get(command);
    if (fn) {
      await fn(ev);
      return;
    }

    // 6) fallback
    this.logger.debug(`[COMMAND] unhandled "${command}" (phase=${phase})`);
  }
}
