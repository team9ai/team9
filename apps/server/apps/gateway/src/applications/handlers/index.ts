export * from './application-handler.interface.js';
export * from './openclaw.handler.js';

import { OpenClawHandler } from './openclaw.handler.js';

/**
 * All application handlers.
 * Add new handlers here when implementing new application types.
 */
export const APPLICATION_HANDLERS = [OpenClawHandler];
