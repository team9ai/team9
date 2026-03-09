import { relations } from 'drizzle-orm';
import { skills } from './skills.js';
import { skillVersions } from './skill-versions.js';
import { skillFiles } from './skill-files.js';
import { tenants } from '../tenant/tenants.js';
import { users } from '../im/users.js';

export const skillsRelations = relations(skills, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [skills.tenantId],
    references: [tenants.id],
  }),
  creator: one(users, {
    fields: [skills.creatorId],
    references: [users.id],
  }),
  versions: many(skillVersions),
  files: many(skillFiles),
}));

export const skillVersionsRelations = relations(skillVersions, ({ one }) => ({
  skill: one(skills, {
    fields: [skillVersions.skillId],
    references: [skills.id],
  }),
  creator: one(users, {
    fields: [skillVersions.creatorId],
    references: [users.id],
  }),
}));

export const skillFilesRelations = relations(skillFiles, ({ one }) => ({
  skill: one(skills, {
    fields: [skillFiles.skillId],
    references: [skills.id],
  }),
}));
