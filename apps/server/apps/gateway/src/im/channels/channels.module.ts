import { Module } from '@nestjs/common';
import { ChannelsController } from './channels.controller.js';
import { ChannelsService } from './channels.service.js';
import { AuthModule } from '../../auth/auth.module.js';

@Module({
  imports: [AuthModule],
  controllers: [ChannelsController],
  providers: [ChannelsService],
  exports: [ChannelsService],
})
export class ChannelsModule {}
