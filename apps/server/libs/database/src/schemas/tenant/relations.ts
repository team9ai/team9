import { relations } from 'drizzle-orm';
import { tenants } from './tenants';
import { tenantMembers } from './tenant-members';
import { users } from '../im/users';
import { channels } from '../im/channels';

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
