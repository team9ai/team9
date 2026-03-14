import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TaskCastClient } from './taskcast.client.js';

@Module({
  imports: [ConfigModule],
  providers: [TaskCastClient],
  exports: [TaskCastClient],
})
export class TaskCastModule {}
