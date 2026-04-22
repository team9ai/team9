// This file is intentionally kept as a thin re-export so that existing
// imports (e.g. AhandEventsSubscriber) don't need path changes.
// The real implementation lives in ahand-session-dispatcher.service.ts.
export {
  AhandSessionDispatcher,
  type AhandDispatchInput,
} from './ahand-session-dispatcher.service.js';
