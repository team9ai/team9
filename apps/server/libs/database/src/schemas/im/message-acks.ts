import {
  pgTable,
  uuid,
  timestamp,
  pgEnum,
  varchar,
  index,
  unique,
  integer,
} from 'drizzle-orm/pg-core';
import { messages } from './messages.js';
import { users } from './users.js';

export const ackStatusEnum = pgEnum('ack_status', [
  'sent', // Server has pushed to client
  'delivered', // Client has confirmed receipt
  'read', // Client has read the message
]);

export const messageAcks = pgTable(
  'im_message_acks',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    // Message ID
    messageId: uuid('message_id')
      .references(() => messages.id, { onDelete: 'cascade' })
      .notNull(),

    // Receiving user ID
    userId: uuid('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),

    // ACK status
    status: ackStatusEnum('status').default('sent').notNull(),

    // Sent time (when server pushed to client)
    sentAt: timestamp('sent_at').defaultNow().notNull(),

    // Delivered time (when client confirmed receipt)
    deliveredAt: timestamp('delivered_at'),

    // Read time
    readAt: timestamp('read_at'),

    // Gateway node that delivered the message
    gatewayId: varchar('gateway_id', { length: 64 }),

    // Retry count for delivery
    retryCount: integer('retry_count').default(0).notNull(),

    // Last retry time
    lastRetryAt: timestamp('last_retry_at'),
  },
  (table) => [
    // Each user can only have one ACK record per message
    unique('unique_message_user_ack').on(table.messageId, table.userId),
    index('idx_message_acks_message_id').on(table.messageId),
    index('idx_message_acks_user_id').on(table.userId),
    index('idx_message_acks_status').on(table.status),
    // For finding pending ACKs that need retry
    index('idx_message_acks_retry').on(table.status, table.retryCount),
  ],
);

export type MessageAck = typeof messageAcks.$inferSelect;
export type NewMessageAck = typeof messageAcks.$inferInsert;
