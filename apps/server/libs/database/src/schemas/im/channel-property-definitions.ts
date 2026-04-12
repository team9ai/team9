import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  boolean,
  pgEnum,
  jsonb,
  integer,
  unique,
  index,
} from 'drizzle-orm/pg-core';
import { channels } from './channels.js';
import { users } from './users.js';

export const propertyValueTypeEnum = pgEnum('property_value_type', [
  'text',
  'number',
  'boolean',
  'single_select',
  'multi_select',
  'person',
  'date',
  'timestamp',
  'date_range',
  'timestamp_range',
  'recurring',
  'url',
  'message_ref',
  'file',
  'image',
  'tags',
]);

export const channelPropertyDefinitions = pgTable(
  'im_channel_property_definitions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    channelId: uuid('channel_id')
      .references(() => channels.id, { onDelete: 'cascade' })
      .notNull(),
    key: varchar('key', { length: 100 }).notNull(),
    description: text('description'),
    valueType: propertyValueTypeEnum('value_type').notNull(),
    isNative: boolean('is_native').default(false).notNull(),
    config: jsonb('config').default({}).notNull(),
    order: integer('order').default(0).notNull(),
    aiAutoFill: boolean('ai_auto_fill').default(true).notNull(),
    aiAutoFillPrompt: text('ai_auto_fill_prompt'),
    isRequired: boolean('is_required').default(false).notNull(),
    defaultValue: jsonb('default_value'),
    showInChatPolicy: varchar('show_in_chat_policy', { length: 20 })
      .default('auto')
      .notNull(),
    allowNewOptions: boolean('allow_new_options').default(true).notNull(),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    unique('uq_channel_property_def_key').on(table.channelId, table.key),
    index('idx_channel_property_def_order').on(table.channelId, table.order),
  ],
);

export type ChannelPropertyDefinition =
  typeof channelPropertyDefinitions.$inferSelect;
export type NewChannelPropertyDefinition =
  typeof channelPropertyDefinitions.$inferInsert;
