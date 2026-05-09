import { relations } from 'drizzle-orm';
import { skills } from './skills.js';
import { tenants } from '../tenant/tenants.js';
import { users } from '../im/users.js';

export const skillsRelations = relations(skills, ({ one }) => ({
  tenant: one(tenants, {
    fields: [skills.tenantId],
    references: [tenants.id],
  }),
  creator: one(users, {
    fields: [skills.creatorId],
    references: [users.id],
  }),
}));
