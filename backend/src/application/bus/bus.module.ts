import { AdaptersBusModule } from '@adapters/bus/bus.module';
// application/bus/bus.module.ts
import { Module } from '@nestjs/common';
import { RedisModule } from '@adapters/redis/redis.module';
import { BusPublisher } from '@adapters/bus/publisher';

@Module({
  imports: [RedisModule],
  providers: [BusPublisher],
  exports: [BusPublisher],
})
export class BusModule {}
