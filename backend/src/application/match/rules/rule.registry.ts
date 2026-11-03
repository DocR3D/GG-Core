import { Injectable } from '@nestjs/common';
import { KnifeRule } from './knife.rule';
import { PhaseRule } from '@domain/rules';
import { WarmupRule } from './warmup.rule';
import { MatchPhase } from '@domain/phase.types';
import { KnifeChoiceRule } from './knife-choice.rule';
import { LiveRule } from './live.rule';
import { PostgameRule } from './postgame.rule';
import { ReadyCommand } from '@app/match/commands/ready.command';
import { KnifeChoiceCommand } from '../commands/knife-choice.command';
import { PauseCommand } from '../commands/pause.command';
import { Optional } from '@nestjs/common';
import { CommunityMessagesService } from '@app/community-messages/community-messages.service';
import { RestoreCommand } from '@app/match/commands/restore.command';

@Injectable()
export class RuleRegistry {
  private readonly rules = new Map<MatchPhase, PhaseRule>();

  constructor(
    private readonly readyCmd: ReadyCommand,
    private readonly knifeCmd: KnifeChoiceCommand,
    private readonly pauseCmd: PauseCommand,
    @Optional() private readonly communityMessages?: CommunityMessagesService,
    @Optional() private readonly restoreCmd?: RestoreCommand,
  ) {
    const warmupRule = new WarmupRule(this.readyCmd, this.communityMessages);
    const knifeRule = new KnifeRule();
    const knifeChoiceRule = new KnifeChoiceRule(this.knifeCmd);
    const liveRule = new LiveRule(this.pauseCmd, this.restoreCmd);
    const postgameRule = new PostgameRule();

    this.rules.set(MatchPhase.WARMUP_MAIN, warmupRule);
    this.rules.set(MatchPhase.KNIFE_WARMUP, warmupRule);
    this.rules.set(MatchPhase.KNIFE_LIVE, knifeRule);
    this.rules.set(MatchPhase.KNIFE_CHOICE, knifeChoiceRule);
    this.rules.set(MatchPhase.LIVE_MAIN, liveRule);
    this.rules.set(MatchPhase.HALFTIME, warmupRule);
    this.rules.set(MatchPhase.OVERTIME, liveRule);
    this.rules.set(MatchPhase.POSTGAME, postgameRule);
  }

  getRule(phase: MatchPhase): PhaseRule {
    return this.rules.get(phase) ?? this.rules.get(MatchPhase.WARMUP_MAIN)!;
  }
}
