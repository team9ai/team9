export * from './application-handler.interface.js';
export * from './openclaw.handler.js';
export * from './base-model-staff.handler.js';
export * from './base-model-staff.presets.js';
export * from './common-staff.handler.js';
export * from './personal-staff.handler.js';

import { OpenClawHandler } from './openclaw.handler.js';
import { BaseModelStaffHandler } from './base-model-staff.handler.js';
import { CommonStaffHandler } from './common-staff.handler.js';
import { PersonalStaffHandler } from './personal-staff.handler.js';

/**
 * All application handlers.
 * Add new handlers here when implementing new application types.
 */
export const APPLICATION_HANDLERS = [
  OpenClawHandler,
  BaseModelStaffHandler,
  CommonStaffHandler,
  PersonalStaffHandler,
];
