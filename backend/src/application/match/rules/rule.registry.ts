import { Injectable } from "@nestjs/common";
import { KnifeRule } from "./knife.rule";
import { PhaseRule } from "@domain/rules";
import { WarmupRule } from "./warmup.rule";
import { MatchPhase } from "@domain/phase.types";
import { KnifeChoiceRule } from "./knife-choice.rule";
import { LiveRule } from "./live.rule";
import { ReadyCommand } from "@app/match/commands/ready.command";
import { KnifeChoiceCommand } from "../commands/knife-choice.command";
import { PauseCommand } from "../commands/pause.command";

@Injectable()
export class RuleRegistry {
  // Cette propriété stockera les instances uniques de chaque règle.
  private readonly rules = new Map<MatchPhase, PhaseRule>();

  constructor(
    // 1. On injecte les DÉPENDANCES des règles, pas les règles elles-mêmes.
    private readonly readyCmd: ReadyCommand,
    private readonly knifeCmd: KnifeChoiceCommand,
    private readonly pauseCmd: PauseCommand,
    // ... Si vos autres règles (KnifeRule, LiveRule, etc.) ont des dépendances,
    // ... vous devez les injecter ici aussi. Par exemple :
    // private readonly someOtherService: SomeOtherService,
  ) {
    // 2. On instancie les règles MANUELLEMENT, une seule fois, en passant les dépendances.
    const warmupRule = new WarmupRule(this.readyCmd);
    const knifeRule = new KnifeRule(/* passez ici ses dépendances si besoin */);
    const knifeChoiceRule = new KnifeChoiceRule(this.knifeCmd);
    const liveRule = new LiveRule(this.pauseCmd);

    // 3. On remplit le registre avec les instances fraîchement créées et complètes.
    this.rules.set(MatchPhase.WARMUP_MAIN, warmupRule);
    this.rules.set(MatchPhase.KNIFE_WARMUP, warmupRule); // Le warmup est souvent utilisé pour plusieurs phases initiales.
    this.rules.set(MatchPhase.KNIFE_LIVE, knifeRule);
    this.rules.set(MatchPhase.KNIFE_CHOICE, knifeChoiceRule);
    this.rules.set(MatchPhase.LIVE_MAIN, liveRule);
  }

  /**
   * Récupère l'instance de la règle associée à une phase de jeu donnée.
   * @param phase La phase actuelle du match.
   * @returns L'instance de la règle correspondante. Retourne la règle du warmup par défaut si aucune règle n'est trouvée.
   */
  getRule(phase: MatchPhase): PhaseRule {
    // On retourne la règle correspondante, avec le warmup comme fallback sûr.
    return this.rules.get(phase) ?? this.rules.get(MatchPhase.WARMUP_MAIN)!;
  }
}