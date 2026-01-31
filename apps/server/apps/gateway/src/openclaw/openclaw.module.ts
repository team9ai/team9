import { Module, Global } from '@nestjs/common';
import { OpenclawService } from './openclaw.service.js';

@Global()
@Module({
  providers: [OpenclawService],
  exports: [OpenclawService],
})
export class OpenclawModule {}
