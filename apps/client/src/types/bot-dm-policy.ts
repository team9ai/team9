export type DmOutboundPolicyMode =
  | "owner-only"
  | "same-tenant"
  | "whitelist"
  | "anyone";

export interface DmOutboundPolicy {
  mode: DmOutboundPolicyMode;
  userIds?: string[];
}
