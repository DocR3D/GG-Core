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
  customMessage?: string;
  ignoreCooldown?: boolean;
}

export type AnnounceSponsorOptions = SponsorAnnounceOptions;

export interface SponsorChatConfig {
  enabled: boolean;
  enableInWarmup: boolean;
  warmupIntervalSec: number;
  enableInPauses: boolean;
  pauseDelaySec: number;
  enableInHalftime: boolean;
  minIntervalBetweenMessagesSec: number;
  prefix: string;
}

export class UpdateSponsorChatConfigDto {
  enabled?: boolean;
  enableInWarmup?: boolean;
  warmupIntervalSec?: number;
  enableInPauses?: boolean;
  pauseDelaySec?: number;
  enableInHalftime?: boolean;
  minIntervalBetweenMessagesSec?: number;
  prefix?: string;
}

export const DEFAULT_SPONSOR_CHAT_CONFIG: SponsorChatConfig = {
  enabled: true,
  enableInWarmup: true,
  warmupIntervalSec: 180,              // 3 minutes entre deux annonces en warmup
  enableInPauses: false,               // Désactivé par défaut en pause pour ne pas déconcentrer les joueurs
  pauseDelaySec: 15,                   // Si activé, délai de 15s après le début de pause avant d'afficher
  enableInHalftime: true,              // Mi-temps (hors de tout gun round)
  minIntervalBetweenMessagesSec: 300,  // Cooldown strict : max 1 message sponsor toutes les 5 min par serveur
  prefix: '[Partenaire]',
};
