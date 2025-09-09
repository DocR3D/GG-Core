import type { BaseEvent } from '@domain/types/base.event';
import { withCtx } from '@domain/types/factory';

export type BuildFn = ReturnType<typeof withCtx>;
export type Extra = Partial<Pick<BaseEvent<any, any>, 'map' | 'round' | 'tick'>>;

export type Rule = {
  re: RegExp;
  build: (m: RegExpMatchArray, build: BuildFn, buildTel: BuildFn, extra: Extra) => any; // MatchEvent
};

// Utilitaires communs
export const CS2_PREFIX_RE = /^(?:L\s\d{2}\/\d{2}\/\d{4}\s-\s\d{2}:\d{2}:\d{2}:\s+)/;
export const stripCs2Prefix = (line: string) => line.replace(CS2_PREFIX_RE, '');
export const toT = (s: string) => (s === 'TERRORIST' ? 'T' : 'CT');
