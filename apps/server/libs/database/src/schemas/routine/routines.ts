import {
  pgTable,
  uuid,
  varchar,
  text,
  integer,
  timestamp,
  jsonb,
  index,
  pgEnum,
} from 'drizzle-orm/pg-core';
import { tenants } from '../tenant/tenants.js';
import { bots } from '../im/bots.js';
import { users } from '../im/users.js';
import { documents } from '../document/documents.js';
import { channels } from '../im/channels.js';

// ── Enums ───────────────────────────────────────────────────────────

export const routineStatusEnum = pgEnum('routine__status', [
  'draft',
  'upcoming',
  'in_progress',
  'paused',
  'pending_action',
  'completed',
  'failed',
  'stopped',
  'timeout',
]);

export const routineScheduleTypeEnum = pgEnum('routine__schedule_type', [
  'once',
  'recurring',
]);

// ── Types ───────────────────────────────────────────────────────────

export interface ScheduleConfig {
  frequency?: string;
  time?: string;
  timezone?: string;
  dayOfWeek?: number;
  dayOfMonth?: number;
  cron?: string;
}

// ── Table ───────────────────────────────────────────────────────────

export const routines = pgTable(
  'routine__routines',
  {
    id: uuid('id').primaryKey().notNull(),

    tenantId: uuid('tenant_id')
      .references(() => tenants.id, { onDelete: 'cascade' })
      .notNull(),

    botId: uuid('bot_id').references(() => bots.id, { onDelete: 'cascade' }),

    creatorId: uuid('creator_id')
      .references(() => users.id)
      .notNull(),

    title: varchar('title', { length: 500 }).notNull(),
    description: text('description'),

    status: routineStatusEnum('status').default('upcoming').notNull(),
    /** @deprecated Use routine__triggers table instead */
    scheduleType: routineScheduleTypeEnum('schedule_type')
      .default('once')
      .notNull(),
    /** @deprecated Use routine__triggers table instead */
    scheduleConfig: jsonb('schedule_config').$type<ScheduleConfig>(),
    /** @deprecated Use routine__triggers.next_run_at instead */
    nextRunAt: timestamp('next_run_at'),

    version: integer('version').default(1).notNull(),

    /**
     * @deprecated migrated to folder9; do not read or write — drop in
     * follow-up PR. Phase A.1 of the routine→folder9-skill migration
     * replaces the linked Document with a folder9 managed skill folder
     * (see `folderId` below).
     */
    documentId: uuid('document_id').references(() => documents.id),

    /**
     * Forward link to the routine's folder9 managed skill folder.
     * Nullable: starts null inside the creation transaction (filled by the
     * post-INSERT UPDATE) and remains null on legacy rows until Layer 1
     * batch migrates them or Layer 2 lazy-provisions via
     * `ensureRoutineFolder`. Application code MUST treat the runtime
     * invariant (non-null after `provisionFolder9SkillFolder`) as authoritative.
     */
    folderId: uuid('folder_id'),

    // Forward reference — FK to routine__executions added via relations
    currentExecutionId: uuid('current_execution_id'),

    creationChannelId: uuid('creation_channel_id').references(
      () => channels.id,
      { onDelete: 'set null' },
    ),
    creationSessionId: varchar('creation_session_id', { length: 255 }),
    sourceRef: varchar('source_ref', { length: 255 }),

    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_routine__routines_tenant_id').on(table.tenantId),
    index('idx_routine__routines_bot_id').on(table.botId),
    index('idx_routine__routines_creator_id').on(table.creatorId),
    index('idx_routine__routines_status').on(table.status),
    index('idx_routine__routines_next_run_at').on(table.nextRunAt),
    index('idx_routine__routines_tenant_status').on(
      table.tenantId,
      table.status,
    ),
    index('idx_routine__routines_creation_channel_id').on(
      table.creationChannelId,
    ),
    index('idx_routine__routines_source_ref').on(table.sourceRef),
  ],
);

export type Routine = typeof routines.$inferSelect;
export type NewRoutine = typeof routines.$inferInsert;
export type RoutineStatus = (typeof routineStatusEnum.enumValues)[number];
export type RoutineScheduleType =
  (typeof routineScheduleTypeEnum.enumValues)[number];
