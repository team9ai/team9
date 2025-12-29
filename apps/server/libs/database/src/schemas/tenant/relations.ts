import { relations } from 'drizzle-orm';
import { tenants } from './tenants.js';
import { tenantMembers } from './tenant-members.js';
import { users } from '../im/users.js';
import { channels } from '../im/channels.js';

export const tenantsRelations = relations(tenants, ({ many }) => ({
  members: many(tenantMembers),
  channels: many(channels),
}));

export const tenantMembersRelations = relations(tenantMembers, ({ one }) => ({
  tenant: one(tenants, {
    fields: [tenantMembers.tenantId],
    references: [tenants.id],
  }),
  user: one(users, {
    fields: [tenantMembers.userId],
    references: [users.id],
  }),
  inviter: one(users, {
    fields: [tenantMembers.invitedBy],
    references: [users.id],
  }),
}));
