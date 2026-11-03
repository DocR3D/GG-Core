// src/application/sponsors/sponsor.types.ts
import { SponsorTier } from '@prisma/client';

export { SponsorTier };

export const DEFAULT_TIER_WEIGHTS: Record<SponsorTier, number> = {
  PRIMARY: 3,
  GOLD: 2,
  STANDARD: 1,
};

export class CreateSponsorDto {
  name!: string;
  description?: string;
  logoUrl?: string;
  websiteUrl?: string;
  tier?: SponsorTier;
  weight?: number;
  active?: boolean;
  messages?: string[];
  tournamentId?: string | null;
}

export class UpdateSponsorDto {
  name?: string;
  description?: string;
  logoUrl?: string;
  websiteUrl?: string;
  tier?: SponsorTier;
  weight?: number;
  active?: boolean;
  messages?: string[];
  tournamentId?: string | null;
}

export interface SponsorFilterDto {
  tournamentId?: string | null;
  activeOnly?: boolean;
  tier?: SponsorTier;
}

export interface SponsorRotatePayload {
  sponsorId: string;
  name: string;
  logoUrl?: string | null;
  websiteUrl?: string | null;
  tier: SponsorTier;
  slot?: string;
  durationMs?: number;
}

export interface SponsorAnnounceOptions {
  serverId?: string;
  sponsorId?: string;
  tournamentId?: string | null;
  prefix?: string;
}
