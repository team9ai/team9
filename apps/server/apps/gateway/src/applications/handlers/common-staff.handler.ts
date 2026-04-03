import { Injectable } from '@nestjs/common';
import type {
  ApplicationHandler,
  InstallContext,
  InstallResult,
} from './application-handler.interface.js';

@Injectable()
export class CommonStaffHandler implements ApplicationHandler {
  readonly applicationId = 'common-staff';

  async onInstall(_context: InstallContext): Promise<InstallResult> {
    return {};
  }
}
