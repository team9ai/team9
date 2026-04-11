import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  doublePrecision,
  jsonb,
  integer,
  varchar,
  unique,
  index,
} from 'drizzle-orm/pg-core';
import { messages } from './messages.js';
import { channelPropertyDefinitions } from './channel-property-definitions.js';
import { users } from './users.js';

export const messageProperties = pgTable(
  'im_message_properties',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    messageId: uuid('message_id')
      .references(() => messages.id, { onDelete: 'cascade' })
      .notNull(),
    propertyDefinitionId: uuid('property_definition_id')
      .references(() => channelPropertyDefinitions.id, { onDelete: 'cascade' })
      .notNull(),
    textValue: text('text_value'),
    numberValue: doublePrecision('number_value'),
    booleanValue: boolean('boolean_value'),
    dateValue: timestamp('date_value'),
    jsonValue: jsonb('json_value'),
    fileKey: varchar('file_key', { length: 500 }),
    fileMetadata: jsonb('file_metadata'),
    order: integer('order').default(0).notNull(),
    createdBy: uuid('created_by').references(() => users.id),
    updatedBy: uuid('updated_by').references(() => users.id),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    unique('uq_message_property').on(
      table.messageId,
      table.propertyDefinitionId,
    ),
    index('idx_message_props_message').on(table.messageId),
    index('idx_message_props_def_text').on(
      table.propertyDefinitionId,
      table.textValue,
    ),
    index('idx_message_props_def_number').on(
      table.propertyDefinitionId,
      table.numberValue,
    ),
    index('idx_message_props_def_date').on(
      table.propertyDefinitionId,
      table.dateValue,
    ),
    index('idx_message_props_def_boolean').on(
      table.propertyDefinitionId,
      table.booleanValue,
    ),
  ],
);

export type MessageProperty = typeof messageProperties.$inferSelect;
export type NewMessageProperty = typeof messageProperties.$inferInsert;
