import { Module } from '@nestjs/common';
import { RabbitmqModule } from '@team9/rabbitmq';
import { MessageModule } from '../message/message.module.js';
import { AckModule } from '../ack/ack.module.js';
import { UpstreamConsumer } from './upstream.consumer.js';

@Module({
  imports: [RabbitmqModule, MessageModule, AckModule],
  providers: [UpstreamConsumer],
})
export class ConsumerModule {}
