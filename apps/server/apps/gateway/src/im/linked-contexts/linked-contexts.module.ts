import { Module, forwardRef } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module.js';
import { ChannelsModule } from '../channels/channels.module.js';
import { MessagesModule } from '../messages/messages.module.js';
import { LinkedContextsController } from './linked-contexts.controller.js';
import { LinkedContextsService } from './linked-contexts.service.js';

@Module({
  imports: [
    AuthModule,
    forwardRef(() => ChannelsModule),
    forwardRef(() => MessagesModule),
  ],
  controllers: [LinkedContextsController],
  providers: [LinkedContextsService],
  exports: [LinkedContextsService],
})
export class LinkedContextsModule {}
