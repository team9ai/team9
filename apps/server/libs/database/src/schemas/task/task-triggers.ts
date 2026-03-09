import {
  pgTable,
  uuid,
  boolean,
  timestamp,
  jsonb,
  index,
  pgEnum,
} from 'drizzle-orm/pg-core';
import { agentTasks } from './tasks.js';

export const agentTaskTriggerTypeEnum = pgEnum('agent_task__trigger_type', [
  'manual',
  'interval',
  'schedule',
  'channel_message',
]);

// ── Config types ────────────────────────────────────────────────────

export interface ManualTriggerConfig {}

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

export const agentTaskTriggers = pgTable(
  'agent_task__triggers',
  {
    id: uuid('id').primaryKey().notNull(),

    taskId: uuid('task_id')
      .references(() => agentTasks.id, { onDelete: 'cascade' })
      .notNull(),

    type: agentTaskTriggerTypeEnum('type').notNull(),

    config: jsonb('config').$type<TriggerConfig>(),

    enabled: boolean('enabled').default(true).notNull(),

    nextRunAt: timestamp('next_run_at'),
    lastRunAt: timestamp('last_run_at'),

    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_agent_task__triggers_task_id').on(table.taskId),
    index('idx_agent_task__triggers_scan').on(
      table.type,
      table.enabled,
      table.nextRunAt,
    ),
  ],
);

export type AgentTaskTrigger = typeof agentTaskTriggers.$inferSelect;
export type NewAgentTaskTrigger = typeof agentTaskTriggers.$inferInsert;
export type AgentTaskTriggerType =
  (typeof agentTaskTriggerTypeEnum.enumValues)[number];
