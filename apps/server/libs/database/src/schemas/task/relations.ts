import { relations } from 'drizzle-orm';
import { taskRuns } from './task-runs.js';
import { taskDeliverables } from './task-deliverables.js';
import { tenants } from '../tenant/tenants.js';
import { bots } from '../im/bots.js';
import { users } from '../im/users.js';
import { routines } from '../routine/routines.js';
import { routineTriggers } from '../routine/routine-triggers.js';
import { channels } from '../im/channels.js';
import { documentVersions } from '../document/document-versions.js';

// ── taskRuns ───────────────────────────────────────────────────────

export const taskRunsRelations = relations(taskRuns, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [taskRuns.tenantId],
    references: [tenants.id],
  }),
  routine: one(routines, {
    fields: [taskRuns.routineId],
    references: [routines.id],
  }),
  bot: one(bots, {
    fields: [taskRuns.botId],
    references: [bots.id],
  }),
  creator: one(users, {
    fields: [taskRuns.creatorId],
    references: [users.id],
  }),
  channel: one(channels, {
    fields: [taskRuns.channelId],
    references: [channels.id],
  }),
  trigger: one(routineTriggers, {
    fields: [taskRuns.triggerId],
    references: [routineTriggers.id],
  }),
  documentVersion: one(documentVersions, {
    fields: [taskRuns.documentVersionId],
    references: [documentVersions.id],
  }),
  deliverables: many(taskDeliverables),
}));

// ── taskDeliverables ───────────────────────────────────────────────

export const taskDeliverablesRelations = relations(
  taskDeliverables,
  ({ one }) => ({
    run: one(taskRuns, {
      fields: [taskDeliverables.runId],
      references: [taskRuns.id],
    }),
    routine: one(routines, {
      fields: [taskDeliverables.routineId],
      references: [routines.id],
    }),
  }),
);
