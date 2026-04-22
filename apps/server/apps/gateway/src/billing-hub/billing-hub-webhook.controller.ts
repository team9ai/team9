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

export type BillingPaymentType = 'subscription' | 'one_time';
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
  stripeSessionId: string;
  stripeSubscriptionId?: string | null;
  // Stripe event id; we forward it as `$insert_id` so PostHog dedupes if
  // billing-hub fires twice for the same underlying event.
  stripeEventId: string;
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

    this.posthogService.capture({
      distinctId: initiatorUserId,
      event: 'payment_completed',
      properties: {
        $insert_id: payload.stripeEventId,
        workspace_id: workspaceId,
        payment_type: payload.paymentType,
        plan_name: payload.productName,
        amount_cents: payload.amountCents,
        currency: payload.currency,
        billing_interval: payload.billingInterval ?? null,
        credits_amount: payload.creditsAmount ?? null,
        stripe_price_id: payload.stripePriceId,
        stripe_session_id: payload.stripeSessionId,
        stripe_subscription_id: payload.stripeSubscriptionId ?? null,
      },
      groups: { workspace: workspaceId },
    });

    this.logger.log(
      `payment_completed captured for user=${initiatorUserId} workspace=${workspaceId} product=${payload.productName}`,
    );

    return { ok: true };
  }
}
