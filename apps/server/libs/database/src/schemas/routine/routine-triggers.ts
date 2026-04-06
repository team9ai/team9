import {
  pgTable,
  uuid,
  boolean,
  timestamp,
  jsonb,
  index,
  pgEnum,
} from 'drizzle-orm/pg-core';
import { routines } from './routines.js';

export const routineTriggerTypeEnum = pgEnum('routine__trigger_type', [
  'manual',
  'interval',
  'schedule',
  'channel_message',
]);

// ── Config types ────────────────────────────────────────────────────

export type ManualTriggerConfig = Record<string, never>;

export interface IntervalTriggerConfig {
  every: number;
  unit: 'minutes' | 'hours' | 'days' | 'weeks' | 'months' | 'years';
}

export interface ScheduleTriggerConfig {
  frequency: 'daily' | 'weekly' | 'monthly' | 'yearly' | 'weekdays';
  time: string;
  timezone: string;
  dayOfWeek?: number;
  dayOfMonth?: number;
}

export interface ChannelMessageTriggerConfig {
  channelId: string;
}

export type TriggerConfig =
  | ManualTriggerConfig
  | IntervalTriggerConfig
  | ScheduleTriggerConfig
  | ChannelMessageTriggerConfig;

// ── Table ───────────────────────────────────────────────────────────

export const routineTriggers = pgTable(
  'routine__triggers',
  {
    id: uuid('id').primaryKey().notNull(),

    routineId: uuid('routine_id')
      .references(() => routines.id, { onDelete: 'cascade' })
      .notNull(),

    type: routineTriggerTypeEnum('type').notNull(),

    config: jsonb('config').$type<TriggerConfig>(),

    enabled: boolean('enabled').default(true).notNull(),

    nextRunAt: timestamp('next_run_at'),
    lastRunAt: timestamp('last_run_at'),

    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_routine__triggers_routine_id').on(table.routineId),
    index('idx_routine__triggers_scan').on(
      table.type,
      table.enabled,
      table.nextRunAt,
    ),
  ],
);

export type RoutineTrigger = typeof routineTriggers.$inferSelect;
export type NewRoutineTrigger = typeof routineTriggers.$inferInsert;
export type RoutineTriggerType =
  (typeof routineTriggerTypeEnum.enumValues)[number];
