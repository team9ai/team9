import {
  pgTable,
  pgEnum,
  uuid,
  varchar,
  integer,
  timestamp,
  jsonb,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { skills } from './skills.js';
import { users } from '../im/users.js';

export const skillVersionStatusEnum = pgEnum('skill_version__status', [
  'draft',
  'published',
  'suggested',
  'rejected',
]);

export interface SkillFileManifestEntry {
  path: string;
  fileId: string;
}

export const skillVersions = pgTable(
  'skill_versions',
  {
    id: uuid('id').primaryKey().notNull(),
    skillId: uuid('skill_id')
      .references(() => skills.id, { onDelete: 'cascade' })
      .notNull(),
    version: integer('version').notNull(),
    message: varchar('message', { length: 255 }),
    status: skillVersionStatusEnum('status').default('draft').notNull(),
    fileManifest: jsonb('file_manifest')
      .$type<SkillFileManifestEntry[]>()
      .default([])
      .notNull(),
    suggestedBy: varchar('suggested_by', { length: 64 }),
    creatorId: uuid('creator_id')
      .references(() => users.id)
      .notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('idx_skill_versions_skill_version').on(
      table.skillId,
      table.version,
    ),
  ],
);

export type SkillVersion = typeof skillVersions.$inferSelect;
export type NewSkillVersion = typeof skillVersions.$inferInsert;
export type SkillVersionStatus =
  (typeof skillVersionStatusEnum.enumValues)[number];
