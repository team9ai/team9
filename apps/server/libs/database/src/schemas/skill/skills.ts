import {
  pgTable,
  pgEnum,
  uuid,
  varchar,
  text,
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

export const skillAgentAccessEnum = pgEnum('skill__agent_access', [
  'none',
  'read',
  'write',
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
    /**
     * Forward link to the folder9 light folder that stores the skill's
     * `skill.md` plus any supporting files. Nullable for legacy rows created
     * before the skill-library folder9 migration.
     */
    folderId: uuid('folder_id'),
    agentAccess: skillAgentAccessEnum('agent_access').default('read').notNull(),
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
export type SkillAgentAccess = (typeof skillAgentAccessEnum.enumValues)[number];
