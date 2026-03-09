import { relations } from 'drizzle-orm';
import { agentTasks } from './tasks.js';
import { agentTaskExecutions } from './task-executions.js';
import { agentTaskSteps } from './task-steps.js';
import { agentTaskDeliverables } from './task-deliverables.js';
import { agentTaskInterventions } from './task-interventions.js';
import { agentTaskTriggers } from './task-triggers.js';
import { tenants } from '../tenant/tenants.js';
import { bots } from '../im/bots.js';
import { users } from '../im/users.js';
import { documents } from '../document/documents.js';
import { channels } from '../im/channels.js';

// ── agentTasks ──────────────────────────────────────────────────────

export const agentTasksRelations = relations(agentTasks, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [agentTasks.tenantId],
    references: [tenants.id],
  }),
  bot: one(bots, {
    fields: [agentTasks.botId],
    references: [bots.id],
  }),
  creator: one(users, {
    fields: [agentTasks.creatorId],
    references: [users.id],
  }),
  document: one(documents, {
    fields: [agentTasks.documentId],
    references: [documents.id],
  }),
  currentExecution: one(agentTaskExecutions, {
    fields: [agentTasks.currentExecutionId],
    references: [agentTaskExecutions.id],
    relationName: 'taskCurrentExecution',
  }),
  executions: many(agentTaskExecutions),
  triggers: many(agentTaskTriggers),
}));

// ── agentTaskExecutions ─────────────────────────────────────────────

export const agentTaskExecutionsRelations = relations(
  agentTaskExecutions,
  ({ one, many }) => ({
    task: one(agentTasks, {
      fields: [agentTaskExecutions.taskId],
      references: [agentTasks.id],
    }),
    channel: one(channels, {
      fields: [agentTaskExecutions.channelId],
      references: [channels.id],
    }),
    steps: many(agentTaskSteps),
    deliverables: many(agentTaskDeliverables),
    interventions: many(agentTaskInterventions),
  }),
);

// ── agentTaskSteps ──────────────────────────────────────────────────

export const agentTaskStepsRelations = relations(agentTaskSteps, ({ one }) => ({
  execution: one(agentTaskExecutions, {
    fields: [agentTaskSteps.executionId],
    references: [agentTaskExecutions.id],
  }),
  task: one(agentTasks, {
    fields: [agentTaskSteps.taskId],
    references: [agentTasks.id],
  }),
}));

// ── agentTaskDeliverables ───────────────────────────────────────────

export const agentTaskDeliverablesRelations = relations(
  agentTaskDeliverables,
  ({ one }) => ({
    execution: one(agentTaskExecutions, {
      fields: [agentTaskDeliverables.executionId],
      references: [agentTaskExecutions.id],
    }),
    task: one(agentTasks, {
      fields: [agentTaskDeliverables.taskId],
      references: [agentTasks.id],
    }),
  }),
);

// ── agentTaskInterventions ──────────────────────────────────────────

export const agentTaskInterventionsRelations = relations(
  agentTaskInterventions,
  ({ one }) => ({
    execution: one(agentTaskExecutions, {
      fields: [agentTaskInterventions.executionId],
      references: [agentTaskExecutions.id],
    }),
    task: one(agentTasks, {
      fields: [agentTaskInterventions.taskId],
      references: [agentTasks.id],
    }),
    step: one(agentTaskSteps, {
      fields: [agentTaskInterventions.stepId],
      references: [agentTaskSteps.id],
    }),
    resolvedByUser: one(users, {
      fields: [agentTaskInterventions.resolvedBy],
      references: [users.id],
    }),
  }),
);

// ── agentTaskTriggers ─────────────────────────────────────────────

export const agentTaskTriggersRelations = relations(
  agentTaskTriggers,
  ({ one }) => ({
    task: one(agentTasks, {
      fields: [agentTaskTriggers.taskId],
      references: [agentTasks.id],
    }),
  }),
);
