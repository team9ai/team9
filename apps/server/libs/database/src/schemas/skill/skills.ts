import {
  pgTable,
  pgEnum,
  uuid,
  varchar,
  text,
  integer,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { tenants } from '../tenant/tenants.js';
import { users } from '../im/users.js';

export const skillTypeEnum = pgEnum('skill__type', [
  'claude_code_skill',
  'prompt_template',
  'general',
]);

export const skills = pgTable(
  'skills',
  {
    id: uuid('id').primaryKey().notNull(),
    tenantId: uuid('tenant_id')
      .references(() => tenants.id, { onDelete: 'cascade' })
      .notNull(),
    name: varchar('name', { length: 255 }).notNull(),
    description: text('description'),
    type: skillTypeEnum('type').notNull(),
    icon: varchar('icon', { length: 64 }),
    currentVersion: integer('current_version').default(0).notNull(),
    creatorId: uuid('creator_id')
      .references(() => users.id)
      .notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [index('idx_skills_tenant_id').on(table.tenantId)],
);

export type Skill = typeof skills.$inferSelect;
export type NewSkill = typeof skills.$inferInsert;
export type SkillType = (typeof skillTypeEnum.enumValues)[number];
