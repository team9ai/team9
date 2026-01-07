import {
  pgTable,
  uuid,
  varchar,
  jsonb,
  timestamp,
  integer,
  index,
  pgEnum,
} from 'drizzle-orm/pg-core';
import { messages } from './messages.js';

export const outboxStatusEnum = pgEnum('outbox_status', [
  'pending',
  'processing',
  'completed',
  'failed',
]);

/**
 * Message Outbox Table
 *
 * Implements the Outbox Pattern for guaranteed message delivery.
 * Messages and outbox events are inserted in the same transaction,
 * ensuring atomicity between persistence and delivery.
 *
 * The OutboxProcessor scans this table and delivers messages to
 * recipients via RabbitMQ.
 */
export const messageOutbox = pgTable(
  'im_message_outbox',
  {
    id: uuid('id').primaryKey().notNull(),

    // Reference to the message being delivered
    messageId: uuid('message_id')
      .references(() => messages.id, { onDelete: 'cascade' })
      .notNull(),

    // Event type (e.g., 'message_created', 'message_updated')
    eventType: varchar('event_type', { length: 64 }).notNull(),

    // Full message payload for delivery (JSON)
    payload: jsonb('payload').notNull(),

    // Processing status
    status: outboxStatusEnum('status').default('pending').notNull(),

    // Retry tracking
    retryCount: integer('retry_count').default(0).notNull(),

    // Timestamps
    createdAt: timestamp('created_at').defaultNow().notNull(),
    processedAt: timestamp('processed_at'),

    // Error information for failed deliveries
    errorMessage: varchar('error_message', { length: 500 }),
  },
  (table) => [
    // Index for polling pending events
    index('idx_outbox_status').on(table.status),
    // Index for ordering by creation time
    index('idx_outbox_created').on(table.createdAt),
    // Index for finding events by message
    index('idx_outbox_message_id').on(table.messageId),
    // Composite index for efficient polling
    index('idx_outbox_status_created').on(table.status, table.createdAt),
  ],
);

export type MessageOutbox = typeof messageOutbox.$inferSelect;
export type NewMessageOutbox = typeof messageOutbox.$inferInsert;
