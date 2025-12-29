import { pgTable, uuid, timestamp, pgEnum, unique } from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';
import { users } from '../im/users.js';

export const tenantRoleEnum = pgEnum('tenant_role', [
  'owner',
  'admin',
  'member',
  'guest',
]);

export const tenantMembers = pgTable(
  'tenant_members',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .references(() => tenants.id, { onDelete: 'cascade' })
      .notNull(),
    userId: uuid('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    role: tenantRoleEnum('role').default('member').notNull(),
    joinedAt: timestamp('joined_at').defaultNow().notNull(),
    invitedBy: uuid('invited_by').references(() => users.id),
  },
  (table) => [unique('unique_tenant_user').on(table.tenantId, table.userId)],
);

export type TenantMember = typeof tenantMembers.$inferSelect;
export type NewTenantMember = typeof tenantMembers.$inferInsert;
