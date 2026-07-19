// src/domain/rules/warmup.rule.ts
import { BaseRule, PhaseRule, RuleContext } from '@domain/rules';
import type { CommandEvent } from '@domain/events/command.event';
import { MatchPhase } from '@domain/phase.types';
import { MessageMode, SaySpec } from '../messages/messages.types';
import { ReadyCommand } from '@app/match/commands/ready.command'; // Import de la commande

export class WarmupRule extends BaseRule implements PhaseRule {
    name = 'warmup_rule' as const;

    publicTypes = new Set<string>([
      'match:state',
      'pause:update',
    ]) as any;

    constructor(
      private readonly readyCmd: ReadyCommand
    ) {
      super();
      this.commands.set('ready', this.onReadyCommand.bind(this));
      this.commands.set('notready', this.onNotReadyCommand.bind(this));
      this.commands.set('rdy', this.onRdyCommand.bind(this));
      this.commands.set('admin', this.onAdminCommand.bind(this));
    }

    async onEnter(ctx: RuleContext) {
      await ctx.state.clearRdyPlayers(ctx.matchId);
      await ctx.say('[Warmup] Tapez !rdy quand vous etes prets.');
      await ctx.orch.push(ctx.matchId, 'match:state', await ctx.state.getSnapshot(ctx.matchId));
    }

    async onExit(_: RuleContext) {}

    private async onReadyCommand(cmd: CommandEvent, ctx: RuleContext) {
      const success = await this.readyCmd.handle(cmd, ctx);

      if (success) {
        if (await ctx.orch.isBothReady(ctx.matchId)) {
          await ctx.say('Les deux équipes sont prêtes ! Lancement du décompte.');
          await this.launchAfterReady(cmd.matchId, cmd.serverId, ctx);
        }
      }
    }

    // Nouvelle version qui délègue à la commande pour !unready
    private async onNotReadyCommand(cmd: CommandEvent, ctx: RuleContext) {
      // La logique est gérée par la commande ready.command.ts
      await this.readyCmd.handle(cmd, ctx);
    }

    private async onRdyCommand(cmd: CommandEvent, ctx: RuleContext) {
      const steamId = cmd.payload?.sender?.steamId;
      if (!steamId) return;

      await ctx.state.addRdyPlayer(cmd.matchId, steamId);

      const [rdyCount, players] = await Promise.all([
        ctx.state.getRdyCount(cmd.matchId),
        ctx.state.getPlayers(cmd.matchId),
      ]);
      const total = players.home.length + players.away.length;

      await ctx.say(`${rdyCount}/${total} joueurs prets`);

      if (rdyCount >= total && total > 0) {
        await ctx.state.clearRdyPlayers(cmd.matchId);
        await ctx.say('Tous les joueurs sont prets ! Lancement dans 5 secondes...');
        await this.launchAfterReady(cmd.matchId, cmd.serverId, ctx);
      }
    }

    private async onAdminCommand(cmd: CommandEvent, ctx: RuleContext) {
      const sub = (cmd.payload?.parameters?.[0] ?? '').toLowerCase();

      const allowed = (process.env.ADMIN_STEAM_IDS ?? '')
        .split(',').map(s => s.trim()).filter(Boolean);
      const steamId = cmd.payload?.sender?.steamId ?? '';
      if (allowed.length > 0 && !allowed.includes(steamId)) {
        await ctx.say('Commande reservee aux administrateurs.');
        return;
      }

      if (sub === 'start') {
        await ctx.say('[Admin] Lancement force du match.');
        await this.launchAfterReady(cmd.matchId, cmd.serverId, ctx);
      } else {
        await ctx.say('Usage: !admin start');
      }
    }

    /**
     * Décide la prochaine phase selon isDecidingMap :
     * - Map décisive (dernière possible du BoN) → KNIFE_LIVE (couteau pour choisir le side)
     * - Maps non-décisives → appliquer knife_undo.cfg + aller directement en LIVE_MAIN
     *   (les sides ont été fixés lors de la création de la série)
     */
    private async launchAfterReady(matchId: string, serverId: string | undefined, ctx: RuleContext) {
      const cfg = await ctx.state.getMatchConfig(matchId);
      const srv = serverId ?? await ctx.state.getServerIdFromMatchId(matchId) ?? '';
      if (cfg.isDecidingMap) {
        await ctx.orch.startPhaseCountdown(matchId, MatchPhase.KNIFE_LIVE, 5, srv);
      } else {
        // Applique les settings compétitifs sans passer par le knife round
        // Go gère automatiquement mp_overtime_enable selon matchConfig.overtimeEnabled
        await ctx.orch.execCfg({ matchId, serverId: srv }, 'ggbot/competitive.cfg');
        await ctx.orch.startPhaseCountdown(matchId, MatchPhase.LIVE_MAIN, 5, srv);
      }
    }

    async say(rct: RuleContext) : Promise<SaySpec> {
      let state = await rct.state.getSnapshot(rct.matchId);
      return [
        {
          mode: MessageMode.Chain,
          items: [
            { text: `>>> ${state.teams.home.name} vs ${state.teams.away.name} <<<`, intervalMs: 20_000 },
            { text: 'Tapez !rdy quand vous etes prets.', intervalMs: 20_000 },
          ],
        },
        {
          mode: MessageMode.Random,
          intervalMs: 60_000,
          items: [
            'La GG-Lan est entierement financé par vos participations ! Merci à vous ! ',
            'Presque dix ans que la GG-Lan existe !',
            'Nous avons eu le plaisir d\'accueillir Croissant Strikeà la 17ême édition',
          ],
        },
      ];
    }
}