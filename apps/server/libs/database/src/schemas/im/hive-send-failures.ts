import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { messages } from './messages.js';
import { bots } from './bots.js';

// im_hive_send_failures: dead-letter table for ClawHiveService.sendInput
// failures from the im-worker post-broadcast fan-out.
//
// processTask marks the outbox `completed` BEFORE sendInput resolves
// (fire-and-forget — see post-broadcast.service.ts:864-887), so a
// failed send is otherwise only visible as a single WARN log line. This
// table lets the dispatch path persist the failure with enough context
// for replay or audit, paired with the `im.hive.send_failures` OTEL
// counter.
//
// Conflict policy on (message_id, bot_id) upserts: increment retry_count
// and refresh last_seen_at + error_message + error_kind so a flapping
// downstream produces one row per (msg, bot) instead of an unbounded
// stream of duplicates.
export const hiveSendFailures = pgTable(
  'im_hive_send_failures',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    // Message + bot pair this failure belongs to.
    messageId: uuid('message_id')
      .references(() => messages.id, { onDelete: 'cascade' })
      .notNull(),
    botId: uuid('bot_id')
      .references(() => bots.id, { onDelete: 'cascade' })
      .notNull(),

    // Routing context. Kept verbatim so an operator inspecting the
    // table can reconstruct the failed dispatch without joining other
    // tables — agentId/sessionId may belong to provider state outside
    // the local DB.
    agentId: text('agent_id').notNull(),
    tenantId: uuid('tenant_id'),
    sessionId: text('session_id').notNull(),
    trackingChannelId: uuid('tracking_channel_id'),

    // Failure detail. errorKind is a short categorical tag so dashboards
    // can group failures (`no_workers`, `timeout`, `http_error`, `other`);
    // errorMessage carries the original Error.message for forensics.
    errorKind: text('error_kind').notNull(),
    errorMessage: text('error_message').notNull(),

    // Counts every observed failure for this (message, bot) pair so a
    // flapping hive doesn't fan into thousands of identical rows.
    retryCount: integer('retry_count').notNull().default(1),

    firstSeenAt: timestamp('first_seen_at').notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('hive_send_failures_msg_bot_unique').on(t.messageId, t.botId),
    index('hive_send_failures_agent_idx').on(t.agentId),
    index('hive_send_failures_tenant_idx').on(t.tenantId),
    index('hive_send_failures_last_seen_idx').on(t.lastSeenAt),
  ],
);

export type HiveSendFailure = typeof hiveSendFailures.$inferSelect;
export type NewHiveSendFailure = typeof hiveSendFailures.$inferInsert;
