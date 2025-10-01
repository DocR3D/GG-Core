// src/domain/commands/command.interface.ts

import { CommandEvent } from '@domain/events/command.event';
import { RuleContext } from '@domain/rules';

export interface ICommand {
    canHandle(event: CommandEvent, context: RuleContext): Promise<boolean>;
    handle(event: CommandEvent, context: RuleContext): Promise<boolean>;
}

export abstract class BaseCommand implements ICommand {

    // Méthode abstraite que chaque commande doit implémenter
    public abstract canHandle(event: CommandEvent, context: RuleContext): Promise<boolean>;

    // Méthode abstraite que chaque commande doit implémenter
    public abstract handle(event: CommandEvent, context: RuleContext): Promise<boolean>;

    // Méthode utilitaire qui pourrait être utile à toutes les commandes
    protected async logCommand(cmdName: string, event: CommandEvent) {
        // Logique de journalisation commune
        const sender = event.payload.sender.name || event.payload.sender.steamId;
        console.log(`Command '${cmdName}' executed by ${sender} in match ${event.matchId}`);
    }
}