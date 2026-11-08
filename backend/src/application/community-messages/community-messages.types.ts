// src/application/community-messages/community-messages.types.ts

export const DEFAULT_COMMUNITY_MESSAGES = [
  'La GG-Lan est entièrement financée par vos participations ! Merci à vous !',
  'Presque dix ans que la GG-Lan existe !',
  "Nous avons eu le plaisir d'accueillir Croissant Strike à la 17ème édition",
];

export class CreateCommunityMessageDto {
  text!: string;
  category?: string;
  active?: boolean;
  tournamentId?: string | null;
}

export class UpdateCommunityMessageDto {
  text?: string;
  category?: string;
  active?: boolean;
  tournamentId?: string | null;
}

export interface CommunityMessageFilterDto {
  tournamentId?: string | null;
  activeOnly?: boolean;
  category?: string;
}
