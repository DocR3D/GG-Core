import type { Application } from 'express';

export type TrustProxy = Parameters<Application['set']>[1];

/** Express trust-proxy setting: hop count, or an explicit list of addresses/subnets/keywords. */
export function parseTrustProxy(value: string | undefined): TrustProxy {
  const raw = value?.trim();
  if (!raw) return 'loopback';
  if (/^\d+$/.test(raw)) return Number(raw);
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}
