// adapters/streams/streams.module.ts
import { Module } from '@nestjs/common';
import { RedisModule } from '@adapters/redis/redis.module';
import { PrimaryConsumer } from './primary-stream.consumer';

@Module({
  imports: [RedisModule],
  providers: [PrimaryConsumer],
  exports: [PrimaryConsumer],
})
export class StreamsModule {}
