import { Module, Global } from '@nestjs/common';
import { DatabaseModule } from '@team9/database';
import { OpenclawController } from './openclaw.controller.js';
import { OpenclawService } from './openclaw.service.js';

@Global()
@Module({
  imports: [DatabaseModule],
  controllers: [OpenclawController],
  providers: [OpenclawService],
  exports: [OpenclawService],
})
export class OpenclawModule {}
