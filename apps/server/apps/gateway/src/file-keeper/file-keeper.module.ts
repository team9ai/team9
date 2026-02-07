import { Module, Global } from '@nestjs/common';
import { FileKeeperService } from './file-keeper.service.js';

@Global()
@Module({
  providers: [FileKeeperService],
  exports: [FileKeeperService],
})
export class FileKeeperModule {}
