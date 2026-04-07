import { Injectable } from '@nestjs/common';
import type {
  ApplicationHandler,
  InstallContext,
  InstallResult,
} from './application-handler.interface.js';

@Injectable()
export class PersonalStaffHandler implements ApplicationHandler {
  readonly applicationId = 'personal-staff';

  onInstall(_context: InstallContext): Promise<InstallResult> {
    // No-op: personal staff bots are created via member lifecycle,
    // not during application installation.
    return Promise.resolve({});
  }
}
