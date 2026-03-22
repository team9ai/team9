export * from './application-handler.interface.js';
export * from './openclaw.handler.js';
export * from './base-model-staff.handler.js';
export * from './base-model-staff.presets.js';

import { OpenClawHandler } from './openclaw.handler.js';
import { BaseModelStaffHandler } from './base-model-staff.handler.js';

/**
 * All application handlers.
 * Add new handlers here when implementing new application types.
 */
export const APPLICATION_HANDLERS = [OpenClawHandler, BaseModelStaffHandler];
