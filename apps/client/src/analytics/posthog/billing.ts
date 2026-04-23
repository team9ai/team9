// apps/client/src/analytics/posthog/billing.ts
import type { BillingProduct } from "@/types/workspace";

/**
 * Derive a stable plan_name slug from a BillingProduct for analytics.
 *
 * Subscription products: uses the product name lowercased and slugified
 * (e.g. "Pro" → "pro", "Team Plus" → "team_plus").
 * One-time credits topup: always returns "credits_topup".
 */
export function inferPlanName(product: BillingProduct): string {
  if (product.type === "one_time") return "credits_topup";
  return product.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/**
 * Map Stripe interval to the analytics billing_interval enum.
 */
export function inferBillingInterval(
  product: BillingProduct,
): "monthly" | "yearly" | null {
  if (product.type === "one_time") return null;
  if (product.interval === "month") return "monthly";
  if (product.interval === "year") return "yearly";
  return null;
}
