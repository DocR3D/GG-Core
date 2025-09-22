/**
 * Shim de compat : expose RuleContextFactory sous @domain/...
 * mais l'implémentation réelle vit côté application.
 */
export { RuleContextFactory } from '@app/rules/rule-context.factory';
