import { relations } from 'drizzle-orm';
import { routines } from './routines.js';
import { routineExecutions } from './routine-executions.js';
import { routineSteps } from './routine-steps.js';
import { routineDeliverables } from './routine-deliverables.js';
import { routineInterventions } from './routine-interventions.js';
import { routineTriggers } from './routine-triggers.js';
import { tenants } from '../tenant/tenants.js';
import { bots } from '../im/bots.js';
import { users } from '../im/users.js';
import { documents } from '../document/documents.js';
import { documentVersions } from '../document/document-versions.js';
import { channels } from '../im/channels.js';

// ── routines ───────────────────────────────────────────────────────

export const routinesRelations = relations(routines, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [routines.tenantId],
    references: [tenants.id],
  }),
  bot: one(bots, {
    fields: [routines.botId],
    references: [bots.id],
  }),
  creator: one(users, {
    fields: [routines.creatorId],
    references: [users.id],
  }),
  document: one(documents, {
    fields: [routines.documentId],
    references: [documents.id],
  }),
  currentExecution: one(routineExecutions, {
    fields: [routines.currentExecutionId],
    references: [routineExecutions.id],
    relationName: 'routineCurrentExecution',
  }),
  executions: many(routineExecutions),
  triggers: many(routineTriggers),
}));

// ── routineExecutions ──────────────────────────────────────────────

export const routineExecutionsRelations = relations(
  routineExecutions,
  ({ one, many }) => ({
    routine: one(routines, {
      fields: [routineExecutions.routineId],
      references: [routines.id],
    }),
    channel: one(channels, {
      fields: [routineExecutions.channelId],
      references: [channels.id],
    }),
    trigger: one(routineTriggers, {
      fields: [routineExecutions.triggerId],
      references: [routineTriggers.id],
    }),
    documentVersion: one(documentVersions, {
      fields: [routineExecutions.documentVersionId],
      references: [documentVersions.id],
    }),
    steps: many(routineSteps),
    deliverables: many(routineDeliverables),
    interventions: many(routineInterventions),
  }),
);

// ── routineSteps ───────────────────────────────────────────────────

export const routineStepsRelations = relations(routineSteps, ({ one }) => ({
  execution: one(routineExecutions, {
    fields: [routineSteps.executionId],
    references: [routineExecutions.id],
  }),
  routine: one(routines, {
    fields: [routineSteps.routineId],
    references: [routines.id],
  }),
}));

// ── routineDeliverables ────────────────────────────────────────────

export const routineDeliverablesRelations = relations(
  routineDeliverables,
  ({ one }) => ({
    execution: one(routineExecutions, {
      fields: [routineDeliverables.executionId],
      references: [routineExecutions.id],
    }),
    routine: one(routines, {
      fields: [routineDeliverables.routineId],
      references: [routines.id],
    }),
  }),
);

// ── routineInterventions ───────────────────────────────────────────

export const routineInterventionsRelations = relations(
  routineInterventions,
  ({ one }) => ({
    execution: one(routineExecutions, {
      fields: [routineInterventions.executionId],
      references: [routineExecutions.id],
    }),
    routine: one(routines, {
      fields: [routineInterventions.routineId],
      references: [routines.id],
    }),
    step: one(routineSteps, {
      fields: [routineInterventions.stepId],
      references: [routineSteps.id],
    }),
    resolvedByUser: one(users, {
      fields: [routineInterventions.resolvedBy],
      references: [users.id],
    }),
  }),
);

// ── routineTriggers ────────────────────────────────────────────────

export const routineTriggersRelations = relations(
  routineTriggers,
  ({ one }) => ({
    routine: one(routines, {
      fields: [routineTriggers.routineId],
      references: [routines.id],
    }),
  }),
);
