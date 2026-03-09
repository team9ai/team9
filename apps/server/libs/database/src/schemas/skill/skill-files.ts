import {
  pgTable,
  uuid,
  varchar,
  text,
  integer,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { skills } from './skills.js';

export const skillFiles = pgTable(
  'skill_files',
  {
    id: uuid('id').primaryKey().notNull(),
    skillId: uuid('skill_id')
      .references(() => skills.id, { onDelete: 'cascade' })
      .notNull(),
    path: varchar('path', { length: 1024 }).notNull(),
    content: text('content').notNull(),
    size: integer('size').default(0).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('idx_skill_files_skill_id').on(table.skillId)],
);

export type SkillFile = typeof skillFiles.$inferSelect;
export type NewSkillFile = typeof skillFiles.$inferInsert;
