import { Injectable } from "@nestjs/common";
import { KnifeRule } from "./knife.rule";
import { PhaseRule } from "@domain/rules";
import { DefaultRule } from "./default.rule";
import { MatchPhase } from "@domain/phase.types";
import { KnifeChoiceRule } from "./knife_choice.rule";
import { LiveRule } from "./live_rule";


@Injectable()
export class RuleRegistry {
  constructor(
    private readonly knifeRule: KnifeRule,
    private readonly defaultRule: DefaultRule,
    private readonly knifeChoice: KnifeChoiceRule,
    private readonly LiveRule: LiveRule,

    // … injecte d’autres rules
  ) {}

  getRule(phase: MatchPhase): PhaseRule {
    switch (phase) {
      case MatchPhase.KNIFE_LIVE:       return this.knifeRule;
      case MatchPhase.KNIFE_CHOICE:     return this.knifeChoice; // ou une KnifeChoiceRule si séparée
      case MatchPhase.LIVE_MAIN:        return this.LiveRule; // ou une KnifeChoiceRule si séparée
      default:                          return this.defaultRule;
      }
    }
}
