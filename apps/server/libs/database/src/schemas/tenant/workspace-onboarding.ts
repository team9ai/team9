import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  jsonb,
  boolean,
  varchar,
  index,
  unique,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';
import { users } from '../im/users.js';

export type WorkspaceOnboardingStatus =
  | 'in_progress'
  | 'skipped'
  | 'completed'
  | 'provisioning'
  | 'provisioned'
  | 'failed';

export interface LocalizedOnboardingText {
  zh?: string;
  en?: string;
  [key: string]: string | undefined;
}

export interface OnboardingRoleSelection {
  description?: string | null;
  selectedRoleId?: string | null;
  selectedRoleSlug?: string | null;
  selectedRoleLabel?: string | null;
  selectedTag?: string;
  selectedRoleCategoryKey?: string | null;
}

export interface OnboardingGeneratedTask {
  id: string;
  emoji: string;
  title: string;
}

export interface OnboardingTasksSelection {
  generatedTasks?: OnboardingGeneratedTask[];
  selectedTaskIds?: string[];
  customTask?: string | null;
}

export interface OnboardingChannelDraft {
  id: string;
  name: string;
}

export interface OnboardingChannelsSelection {
  channelDrafts?: OnboardingChannelDraft[];
  activeChannelId?: string | null;
}

export interface OnboardingMainAgentDraft {
  emoji: string;
  name: string;
  description: string;
}

export interface OnboardingChildAgentDraft {
  id: string;
  emoji: string;
  name: string;
}

export interface OnboardingAgentsSelection {
  main?: OnboardingMainAgentDraft;
  children?: OnboardingChildAgentDraft[];
}

export interface OnboardingInviteSelection {
  invitationCode?: string;
  invitationUrl?: string;
}

export interface OnboardingPlanSelection {
  selectedPlan?: string | null;
  checkoutCompleted?: boolean;
}

export interface WorkspaceOnboardingStepData {
  role?: OnboardingRoleSelection;
  tasks?: OnboardingTasksSelection;
  channels?: OnboardingChannelsSelection;
  agents?: OnboardingAgentsSelection;
  invite?: OnboardingInviteSelection;
  plan?: OnboardingPlanSelection;
}

export const workspaceOnboarding = pgTable(
  'workspace_onboarding',
  {
    id: uuid('id').primaryKey().notNull(),
    tenantId: uuid('tenant_id')
      .references(() => tenants.id, { onDelete: 'cascade' })
      .notNull(),
    userId: uuid('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    status: text('status').default('in_progress').notNull(),
    currentStep: integer('current_step').default(1).notNull(),
    stepData: jsonb('step_data')
      .$type<WorkspaceOnboardingStepData>()
      .default({})
      .notNull(),
    version: integer('version').default(1).notNull(),
    completedAt: timestamp('completed_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    unique('workspace_onboarding_tenant_user_unique').on(
      table.tenantId,
      table.userId,
    ),
    index('workspace_onboarding_tenant_idx').on(table.tenantId),
    index('workspace_onboarding_user_idx').on(table.userId),
  ],
);

export const onboardingRoles = pgTable(
  'onboarding_roles',
  {
    id: uuid('id').primaryKey().notNull(),
    slug: varchar('slug', { length: 100 }).notNull(),
    emoji: varchar('emoji', { length: 16 }).notNull(),
    label: jsonb('label').$type<LocalizedOnboardingText>().notNull(),
    category: jsonb('category').$type<LocalizedOnboardingText>().notNull(),
    categoryKey: varchar('category_key', { length: 32 }).notNull(),
    featured: boolean('featured').default(false).notNull(),
    sortOrder: integer('sort_order').default(0).notNull(),
    isActive: boolean('is_active').default(true).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    unique('onboarding_roles_slug_unique').on(table.slug),
    index('onboarding_roles_category_idx').on(table.categoryKey),
    index('onboarding_roles_active_idx').on(table.isActive),
  ],
);

export type WorkspaceOnboarding = typeof workspaceOnboarding.$inferSelect;
export type NewWorkspaceOnboarding = typeof workspaceOnboarding.$inferInsert;
export type OnboardingRole = typeof onboardingRoles.$inferSelect;
export type NewOnboardingRole = typeof onboardingRoles.$inferInsert;
