// Workspace types

export interface CreateWorkspaceDto {
  name: string;
  domain?: string;
}

export interface UpdateWorkspaceDto {
  name?: string;
  slug?: string;
  logoUrl?: string | null;
}

export interface WorkspaceResponse {
  id: string;
  name: string;
  slug: string;
  domain: string | null;
  logoUrl: string | null;
  plan: "free" | "pro" | "enterprise";
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface UserWorkspace {
  id: string;
  name: string;
  slug: string;
  role: "owner" | "admin" | "member" | "guest";
  joinedAt: string;
}

export interface WorkspaceInvitation {
  id: string;
  code: string;
  url: string;
  role: "owner" | "admin" | "member" | "guest";
  maxUses?: number;
  usedCount: number;
  expiresAt?: string;
  isActive: boolean;
  createdAt: string;
  createdBy?: {
    id: string;
    username: string;
    displayName?: string;
  };
}

export interface CreateInvitationDto {
  role?: "owner" | "admin" | "member" | "guest";
  maxUses?: number;
  expiresInDays?: number;
}

export interface InvitationInfo {
  workspaceName: string;
  workspaceSlug: string;
  invitedBy?: string;
  expiresAt?: string;
  isValid: boolean;
  reason?: string;
}

export interface AcceptInvitationResponse {
  workspace: {
    id: string;
    name: string;
    slug: string;
  };
  member: {
    id: string;
    role: string;
    joinedAt: string;
  };
}

export interface WorkspaceMember {
  id: string;
  userId: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  role: "owner" | "admin" | "member" | "guest";
  status: "online" | "offline" | "away" | "busy";
  userType?: "human" | "bot" | "system";
  joinedAt: string;
  invitedBy?: string;
  lastSeenAt: string | null;
}

export interface GetMembersParams {
  page?: number;
  limit?: number;
  search?: string;
}

export interface PaginatedMembersResponse {
  members: WorkspaceMember[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface BillingProductDisplay {
  badge?: string;
  description?: string;
  features: string[];
  sortOrder: number;
}

export interface BillingProductCustomAmount {
  enabled: boolean;
  minimumCents?: number | null;
  maximumCents?: number | null;
  presetCents?: number | null;
}

export interface BillingProduct {
  stripePriceId: string;
  name: string;
  type?: "subscription" | "one_time";
  credits?: number;
  amountCents: number;
  interval: string | null;
  intervalCount?: number | null;
  active: boolean;
  metadata?: Record<string, unknown> | null;
  customAmount?: BillingProductCustomAmount;
  display: BillingProductDisplay;
}

export interface WorkspaceSubscription {
  stripeSubscriptionId: string;
  status: string;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
  product: BillingProduct;
}

export interface WorkspaceBillingSummary {
  subscription: WorkspaceSubscription | null;
  managementAllowed: boolean;
}

export interface WorkspaceBillingAccount {
  id: string;
  ownerExternalId: string;
  ownerType: "personal" | "organization";
  ownerName: string | null;
  balance: number;
  quota: number;
  quotaExpiresAt: string | null;
  effectiveQuota: number;
  available: number;
  creditLimit: number;
  status: "active" | "frozen";
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceBillingTransaction {
  id: string;
  accountId: string;
  type: string;
  amount: number;
  balanceBefore: number;
  balanceAfter: number;
  operatorExternalId: string | null;
  agentId: string | null;
  referenceType: string | null;
  referenceId: string | null;
  description: string | null;
  createdAt: string;
  productName: string | null;
  paymentAmountCents: number | null;
  invoiceId: string | null;
}

export interface WorkspaceBillingOverview {
  account: WorkspaceBillingAccount | null;
  subscription: WorkspaceSubscription | null;
  subscriptionProducts: BillingProduct[];
  creditProducts: BillingProduct[];
  recentTransactions: WorkspaceBillingTransaction[];
}

export type WorkspaceOnboardingStatus =
  | "in_progress"
  | "skipped"
  | "completed"
  | "provisioning"
  | "provisioned"
  | "failed";

export type OnboardingRoleCategoryKey =
  | "recommended"
  | "finance"
  | "legal"
  | "consulting"
  | "marketing"
  | "sales"
  | "ecommerce"
  | "creator"
  | "influencer"
  | "design"
  | "engineering"
  | "ai"
  | "education"
  | "business_functions";

export interface OnboardingRoleCatalogItem {
  id: string;
  slug: string;
  emoji: string;
  label: string;
  categoryKey: OnboardingRoleCategoryKey | string;
  category: string;
  featured: boolean;
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

export interface WorkspaceOnboarding {
  id: string;
  tenantId: string;
  userId: string;
  status: WorkspaceOnboardingStatus;
  currentStep: number;
  stepData: WorkspaceOnboardingStepData;
  version: number;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
