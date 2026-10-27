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

@Injectable()
export class RuleRegistry {
  private readonly rules = new Map<MatchPhase, PhaseRule>();

  constructor(
    private readonly readyCmd: ReadyCommand,
    private readonly knifeCmd: KnifeChoiceCommand,
    private readonly pauseCmd: PauseCommand,
  ) {
    const warmupRule = new WarmupRule(this.readyCmd);
    const knifeRule = new KnifeRule();
    const knifeChoiceRule = new KnifeChoiceRule(this.knifeCmd);
    const liveRule = new LiveRule(this.pauseCmd);
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
