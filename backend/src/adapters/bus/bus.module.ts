import { Module } from '@nestjs/common';
import { BusPublisher } from '@adapters/bus/publisher';

@Module({
  providers: [BusPublisher],
  exports: [BusPublisher],
})
export class AdaptersBusModule {}
