// src/application/community-messages/community-messages.module.ts
import { Module } from '@nestjs/common';
import { DatabaseModule } from '@adapters/database/database.module';
import { CommunityMessagesService } from './community-messages.service';

@Module({
  imports: [DatabaseModule],
  providers: [CommunityMessagesService],
  exports: [CommunityMessagesService],
})
export class CommunityMessagesModule {}
