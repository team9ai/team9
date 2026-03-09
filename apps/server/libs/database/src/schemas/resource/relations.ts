import { relations } from 'drizzle-orm';
import { resources } from './resources.js';
import { resourceUsageLogs } from './resource-usage-logs.js';
import { tenants } from '../tenant/tenants.js';
import { users } from '../im/users.js';

export const resourcesRelations = relations(resources, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [resources.tenantId],
    references: [tenants.id],
  }),
  creator: one(users, {
    fields: [resources.creatorId],
    references: [users.id],
  }),
  usageLogs: many(resourceUsageLogs),
}));

export const resourceUsageLogsRelations = relations(
  resourceUsageLogs,
  ({ one }) => ({
    resource: one(resources, {
      fields: [resourceUsageLogs.resourceId],
      references: [resources.id],
    }),
  }),
);
