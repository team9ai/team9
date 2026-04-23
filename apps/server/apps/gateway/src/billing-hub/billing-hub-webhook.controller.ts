import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Headers,
  HttpCode,
  Logger,
  Post,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PosthogService } from '@team9/posthog';
import { env } from '@team9/shared';

export type BillingPaymentType =
  | 'subscription'
  | 'subscription_renewal'
  | 'subscription_update'
  | 'one_time';
// Raw Stripe interval (`month`/`year`), as surfaced by billing-hub.
export type BillingInterval = 'month' | 'year';

interface BillingPaymentSucceededPayload {
  // Opaque owner identifier that billing-hub uses; for team9 this is
  // `tenant:<workspaceId>` — we strip the prefix to derive workspace id.
  ownerExternalId: string;
  // Passthrough of whatever metadata team9 handed to billing-hub when
  // creating the checkout session. Must contain initiatorUserId.
  metadata?: Record<string, string>;
  paymentType: BillingPaymentType;
  productName: string;
  amountCents: number;
  currency: string;
  billingInterval?: BillingInterval | null;
  creditsAmount?: number | null;
  stripePriceId: string;
  // Exactly one of stripeSessionId / stripeInvoiceId is set. Checkout-driven
  // events (initial signup, topup) carry a session id; invoice-driven events
  // (renewal, plan update) carry an invoice id.
  stripeSessionId?: string | null;
  stripeInvoiceId?: string | null;
  stripeSubscriptionId?: string | null;
  stripeEventId: string;
  // Raw Stripe invoice.billing_reason for invoice-driven events, passed
  // through for downstream segmentation.
  billingReason?: string | null;
}

const TENANT_OWNER_PREFIX = 'tenant:';

@Controller('webhooks/billing')
export class BillingHubWebhookController {
  private readonly logger = new Logger(BillingHubWebhookController.name);

  constructor(private readonly posthogService: PosthogService) {}

  @Post('payment-succeeded')
  @HttpCode(200)
  handlePaymentSucceeded(
    @Body() payload: BillingPaymentSucceededPayload,
    @Headers('x-webhook-secret') secret?: string,
  ): { ok: true } {
    const expected = env.BILLING_HUB_WEBHOOK_SECRET;
    if (!expected) {
      throw new ServiceUnavailableException(
        'Billing webhook is not configured',
      );
    }
    if (secret !== expected) {
      throw new ForbiddenException('Invalid webhook secret');
    }

    if (!payload?.ownerExternalId?.startsWith(TENANT_OWNER_PREFIX)) {
      throw new BadRequestException(
        'ownerExternalId must be in the form tenant:<workspaceId>',
      );
    }

    const workspaceId = payload.ownerExternalId.slice(
      TENANT_OWNER_PREFIX.length,
    );
    const initiatorUserId = payload.metadata?.initiatorUserId;
    if (!workspaceId || !initiatorUserId) {
      throw new BadRequestException(
        'metadata.initiatorUserId and derived workspaceId are required',
      );
    }

    // Dedup key: session id for checkout-driven events, invoice id for
    // invoice-driven events. Both are stable per underlying payment across
    // Stripe's event variants (sync vs async, retries). Stripe event id is
    // too narrow — a single payment can produce multiple event ids.
    const insertId = payload.stripeSessionId ?? payload.stripeInvoiceId;
    if (!insertId) {
      throw new BadRequestException(
        'Either stripeSessionId or stripeInvoiceId is required',
      );
    }

    this.posthogService.capture({
      distinctId: initiatorUserId,
      event: 'payment_completed',
      properties: {
        $insert_id: insertId,
        workspace_id: workspaceId,
        payment_type: payload.paymentType,
        plan_name: payload.productName,
        amount_cents: payload.amountCents,
        currency: payload.currency,
        billing_interval: payload.billingInterval ?? null,
        credits_amount: payload.creditsAmount ?? null,
        stripe_price_id: payload.stripePriceId,
        stripe_session_id: payload.stripeSessionId ?? null,
        stripe_invoice_id: payload.stripeInvoiceId ?? null,
        stripe_subscription_id: payload.stripeSubscriptionId ?? null,
        stripe_event_id: payload.stripeEventId,
        billing_reason: payload.billingReason ?? null,
      },
      groups: { workspace: workspaceId },
    });

    this.logger.log(
      `payment_completed[${payload.paymentType}] user=${initiatorUserId} workspace=${workspaceId} product=${payload.productName}`,
    );

    return { ok: true };
  }
}
