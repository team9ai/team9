import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import {
  BadRequestException,
  ForbiddenException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { BillingHubWebhookController } from './billing-hub-webhook.controller.js';

const originalEnv = { ...process.env };

describe('BillingHubWebhookController', () => {
  let controller: BillingHubWebhookController;
  let posthogService: { capture: jest.Mock };

  function buildPayload(overrides: Record<string, unknown> = {}) {
    return {
      ownerExternalId: 'tenant:ws-1',
      metadata: { initiatorUserId: 'user-1' },
      paymentType: 'subscription' as const,
      productName: 'Team Monthly',
      amountCents: 2900,
      currency: 'usd',
      billingInterval: 'month' as const,
      creditsAmount: 50000,
      stripePriceId: 'price_monthly',
      stripeSessionId: 'cs_1',
      stripeSubscriptionId: 'sub_1',
      stripeEventId: 'evt_1',
      ...overrides,
    };
  }

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.BILLING_HUB_WEBHOOK_SECRET = 'secret';
    posthogService = { capture: jest.fn() };
    controller = new BillingHubWebhookController(posthogService as any);
  });

  it('captures payment_completed with derived workspaceId + session-scoped $insert_id', () => {
    const result = controller.handlePaymentSucceeded(
      buildPayload() as never,
      'secret',
    );

    expect(result).toEqual({ ok: true });
    expect(posthogService.capture).toHaveBeenCalledWith({
      distinctId: 'user-1',
      event: 'payment_completed',
      properties: {
        $insert_id: 'cs_1',
        workspace_id: 'ws-1',
        payment_type: 'subscription',
        plan_name: 'Team Monthly',
        amount_cents: 2900,
        currency: 'usd',
        billing_interval: 'month',
        credits_amount: 50000,
        stripe_price_id: 'price_monthly',
        stripe_session_id: 'cs_1',
        stripe_invoice_id: null,
        stripe_subscription_id: 'sub_1',
        stripe_event_id: 'evt_1',
        billing_reason: null,
      },
      groups: { workspace: 'ws-1' },
    });
  });

  it('uses stripeInvoiceId as $insert_id for subscription_renewal events (no sessionId)', () => {
    controller.handlePaymentSucceeded(
      buildPayload({
        paymentType: 'subscription_renewal',
        stripeSessionId: null,
        stripeInvoiceId: 'in_renew_1',
        billingReason: 'subscription_cycle',
      }) as never,
      'secret',
    );

    expect(posthogService.capture).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'payment_completed',
        properties: expect.objectContaining({
          $insert_id: 'in_renew_1',
          payment_type: 'subscription_renewal',
          stripe_session_id: null,
          stripe_invoice_id: 'in_renew_1',
          billing_reason: 'subscription_cycle',
        }),
      }),
    );
  });

  it('uses stripeInvoiceId for subscription_update events', () => {
    controller.handlePaymentSucceeded(
      buildPayload({
        paymentType: 'subscription_update',
        stripeSessionId: null,
        stripeInvoiceId: 'in_update_1',
        billingReason: 'subscription_update',
      }) as never,
      'secret',
    );

    const capture = posthogService.capture.mock.calls[0][0] as {
      properties: { $insert_id: string; payment_type: string };
    };
    expect(capture.properties.$insert_id).toBe('in_update_1');
    expect(capture.properties.payment_type).toBe('subscription_update');
  });

  it('rejects payloads that carry neither stripeSessionId nor stripeInvoiceId', () => {
    expect(() =>
      controller.handlePaymentSucceeded(
        buildPayload({
          stripeSessionId: null,
          stripeInvoiceId: null,
        }) as never,
        'secret',
      ),
    ).toThrow(BadRequestException);
    expect(posthogService.capture).not.toHaveBeenCalled();
  });

  it('dedupes duplicate deliveries of the same session under different stripe event ids', () => {
    controller.handlePaymentSucceeded(
      buildPayload({ stripeEventId: 'evt_completed' }) as never,
      'secret',
    );
    controller.handlePaymentSucceeded(
      buildPayload({ stripeEventId: 'evt_async_payment_succeeded' }) as never,
      'secret',
    );

    // Both captures land on PostHog, but both carry the same $insert_id
    // (the session id), so PostHog dedupes downstream.
    const calls = posthogService.capture.mock.calls;
    expect(calls).toHaveLength(2);
    expect(
      (calls[0][0] as { properties: { $insert_id: string } }).properties
        .$insert_id,
    ).toBe('cs_1');
    expect(
      (calls[1][0] as { properties: { $insert_id: string } }).properties
        .$insert_id,
    ).toBe('cs_1');
  });

  it('rejects with 503 when secret is not configured', () => {
    delete process.env.BILLING_HUB_WEBHOOK_SECRET;

    expect(() =>
      controller.handlePaymentSucceeded(buildPayload() as never, 'anything'),
    ).toThrow(ServiceUnavailableException);
    expect(posthogService.capture).not.toHaveBeenCalled();
  });

  it('rejects mismatched or missing secret with 403', () => {
    expect(() =>
      controller.handlePaymentSucceeded(buildPayload() as never, 'wrong'),
    ).toThrow(ForbiddenException);

    expect(() =>
      controller.handlePaymentSucceeded(buildPayload() as never, undefined),
    ).toThrow(ForbiddenException);

    expect(posthogService.capture).not.toHaveBeenCalled();
  });

  it('rejects ownerExternalId not prefixed by tenant:', () => {
    expect(() =>
      controller.handlePaymentSucceeded(
        buildPayload({ ownerExternalId: 'random:ws-1' }) as never,
        'secret',
      ),
    ).toThrow(BadRequestException);
    expect(posthogService.capture).not.toHaveBeenCalled();
  });

  it('rejects when metadata.initiatorUserId is missing', () => {
    expect(() =>
      controller.handlePaymentSucceeded(
        buildPayload({ metadata: {} }) as never,
        'secret',
      ),
    ).toThrow(BadRequestException);
    expect(posthogService.capture).not.toHaveBeenCalled();
  });
});
