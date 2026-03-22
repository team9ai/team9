import { Module } from '@nestjs/common';
import { ClawHiveService } from './claw-hive.service.js';

@Module({
  providers: [ClawHiveService],
  exports: [ClawHiveService],
})
export class ClawHiveModule {}
