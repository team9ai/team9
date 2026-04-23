import {
  pgTable,
  uuid,
  timestamp,
  pgEnum,
  index,
  unique,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { messages } from './messages.js';
import { channels } from './channels.js';
import { channelPropertyDefinitions } from './channel-property-definitions.js';
import { tenants } from '../tenant/tenants.js';
import { users } from './users.js';

export const relationKindEnum = pgEnum('relation_kind', ['parent', 'related']);

export const messageRelations = pgTable(
  'im_message_relations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').references(() => tenants.id, {
      onDelete: 'cascade',
    }),
    channelId: uuid('channel_id')
      .references(() => channels.id, { onDelete: 'cascade' })
      .notNull(),
    sourceMessageId: uuid('source_message_id')
      .references(() => messages.id, { onDelete: 'cascade' })
      .notNull(),
    targetMessageId: uuid('target_message_id')
      .references(() => messages.id, { onDelete: 'cascade' })
      .notNull(),
    propertyDefinitionId: uuid('property_definition_id')
      .references(() => channelPropertyDefinitions.id, { onDelete: 'cascade' })
      .notNull(),
    relationKind: relationKindEnum('relation_kind').notNull(),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    unique('uq_message_relation_edge').on(
      table.sourceMessageId,
      table.propertyDefinitionId,
      table.targetMessageId,
    ),
    check(
      'chk_message_relation_no_self',
      sql`${table.sourceMessageId} <> ${table.targetMessageId}`,
    ),
    index('idx_mr_source_kind').on(table.sourceMessageId, table.relationKind),
    index('idx_mr_target_kind').on(table.targetMessageId, table.relationKind),
    index('idx_mr_channel_kind').on(table.channelId, table.relationKind),
    index('idx_mr_propdef').on(table.propertyDefinitionId),
  ],
);

export type MessageRelation = typeof messageRelations.$inferSelect;
export type NewMessageRelation = typeof messageRelations.$inferInsert;
