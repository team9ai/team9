import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { HttpException, ServiceUnavailableException } from '@nestjs/common';
import { BillingHubService } from './billing-hub.service.js';

describe('BillingHubService', () => {
  let service: BillingHubService;

  beforeEach(() => {
    process.env.APP_URL = 'https://team9.ai';
    process.env.BILLING_HUB_BASE_URL = 'https://billing.example.com';
    process.env.BILLING_HUB_SERVICE_KEY = 'team9-service-key';
    service = new BillingHubService();
    global.fetch = jest.fn<any>();
  });

  it('maps workspaceId to tenant ownerExternalId and sends service key header', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      text: jest.fn<any>().mockResolvedValue(
        JSON.stringify({
          success: true,
          data: {
            checkoutUrl: 'https://checkout.stripe.com/c/pay/cs_test',
            sessionId: 'cs_test',
          },
        }),
      ),
    });

    await service.createWorkspaceCheckout(
      '72ecfcd7-d495-43a4-8b8a-8fda2d9cec14',
      'price_pro_monthly',
    );

    expect(global.fetch).toHaveBeenCalledWith(
      'https://billing.example.com/api/billing/stripe/checkout/subscription',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'X-Service-Key': 'team9-service-key',
        }),
        body: JSON.stringify({
          ownerExternalId: 'tenant:72ecfcd7-d495-43a4-8b8a-8fda2d9cec14',
          priceId: 'price_pro_monthly',
          successUrl:
            'https://team9.ai/subscription?workspaceId=72ecfcd7-d495-43a4-8b8a-8fda2d9cec14&result=success',
          cancelUrl:
            'https://team9.ai/subscription?workspaceId=72ecfcd7-d495-43a4-8b8a-8fda2d9cec14&result=cancel',
        }),
      }),
    );
  });

  it('uses the one-time Stripe checkout route for credit packs', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      text: jest.fn<any>().mockResolvedValue(
        JSON.stringify({
          success: true,
          data: {
            checkoutUrl: 'https://checkout.stripe.com/c/pay/cs_pack',
            sessionId: 'cs_pack',
          },
        }),
      ),
    });

    await service.createWorkspaceCheckout(
      '72ecfcd7-d495-43a4-8b8a-8fda2d9cec14',
      'price_credit_pack',
      'one_time',
      'plans',
      5500,
    );

    expect(global.fetch).toHaveBeenCalledWith(
      'https://billing.example.com/api/billing/stripe/checkout/one-time',
      expect.objectContaining({
        body: JSON.stringify({
          ownerExternalId: 'tenant:72ecfcd7-d495-43a4-8b8a-8fda2d9cec14',
          priceId: 'price_credit_pack',
          successUrl:
            'https://team9.ai/subscription?workspaceId=72ecfcd7-d495-43a4-8b8a-8fda2d9cec14&result=success',
          cancelUrl:
            'https://team9.ai/subscription?workspaceId=72ecfcd7-d495-43a4-8b8a-8fda2d9cec14&result=cancel',
          amountCents: 5500,
        }),
      }),
    );
  });

  it('preserves the credits view in checkout and portal return URLs', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      text: jest.fn<any>().mockResolvedValue(
        JSON.stringify({
          success: true,
          data: {
            checkoutUrl: 'https://checkout.stripe.com/c/pay/cs_pack',
            sessionId: 'cs_pack',
            portalUrl: 'https://billing.stripe.com/session',
          },
        }),
      ),
    });

    await service.createWorkspaceCheckout(
      '72ecfcd7-d495-43a4-8b8a-8fda2d9cec14',
      'price_credit_pack',
      'one_time',
      'credits',
    );

    expect(global.fetch).toHaveBeenCalledWith(
      'https://billing.example.com/api/billing/stripe/checkout/one-time',
      expect.objectContaining({
        body: JSON.stringify({
          ownerExternalId: 'tenant:72ecfcd7-d495-43a4-8b8a-8fda2d9cec14',
          priceId: 'price_credit_pack',
          successUrl:
            'https://team9.ai/subscription?workspaceId=72ecfcd7-d495-43a4-8b8a-8fda2d9cec14&result=success&view=credits',
          cancelUrl:
            'https://team9.ai/subscription?workspaceId=72ecfcd7-d495-43a4-8b8a-8fda2d9cec14&result=cancel&view=credits',
        }),
      }),
    );

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: jest.fn<any>().mockResolvedValue(
        JSON.stringify({
          success: true,
          data: {
            portalUrl: 'https://billing.stripe.com/session',
          },
        }),
      ),
    });

    await service.createWorkspacePortal(
      '72ecfcd7-d495-43a4-8b8a-8fda2d9cec14',
      'credits',
    );

    expect(global.fetch).toHaveBeenLastCalledWith(
      'https://billing.example.com/api/billing/stripe/portal',
      expect.objectContaining({
        body: JSON.stringify({
          ownerExternalId: 'tenant:72ecfcd7-d495-43a4-8b8a-8fda2d9cec14',
          returnUrl:
            'https://team9.ai/subscription?workspaceId=72ecfcd7-d495-43a4-8b8a-8fda2d9cec14&view=credits',
        }),
      }),
    );
  });

  it('supports custom app-relative return paths for onboarding checkout and portal flows', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      text: jest.fn<any>().mockResolvedValue(
        JSON.stringify({
          success: true,
          data: {
            checkoutUrl: 'https://checkout.stripe.com/c/pay/cs_custom',
            sessionId: 'cs_custom',
          },
        }),
      ),
    });

    await service.createWorkspaceCheckout(
      '72ecfcd7-d495-43a4-8b8a-8fda2d9cec14',
      'price_pro_monthly',
      'subscription',
      'plans',
      undefined,
      '/onboarding?step=6&result=success',
      '/onboarding?step=6&result=cancel',
    );

    expect(global.fetch).toHaveBeenCalledWith(
      'https://billing.example.com/api/billing/stripe/checkout/subscription',
      expect.objectContaining({
        body: JSON.stringify({
          ownerExternalId: 'tenant:72ecfcd7-d495-43a4-8b8a-8fda2d9cec14',
          priceId: 'price_pro_monthly',
          successUrl:
            'https://team9.ai/onboarding?step=6&result=success&workspaceId=72ecfcd7-d495-43a4-8b8a-8fda2d9cec14',
          cancelUrl:
            'https://team9.ai/onboarding?step=6&result=cancel&workspaceId=72ecfcd7-d495-43a4-8b8a-8fda2d9cec14',
        }),
      }),
    );

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: jest.fn<any>().mockResolvedValue(
        JSON.stringify({
          success: true,
          data: {
            portalUrl: 'https://billing.stripe.com/session',
          },
        }),
      ),
    });

    await service.createWorkspacePortal(
      '72ecfcd7-d495-43a4-8b8a-8fda2d9cec14',
      'plans',
      '/onboarding?step=6',
    );

    expect(global.fetch).toHaveBeenLastCalledWith(
      'https://billing.example.com/api/billing/stripe/portal',
      expect.objectContaining({
        body: JSON.stringify({
          ownerExternalId: 'tenant:72ecfcd7-d495-43a4-8b8a-8fda2d9cec14',
          returnUrl:
            'https://team9.ai/onboarding?step=6&workspaceId=72ecfcd7-d495-43a4-8b8a-8fda2d9cec14',
        }),
      }),
    );
  });

  it('throws HttpException for upstream 4xx responses', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 409,
      text: jest.fn<any>().mockResolvedValue(
        JSON.stringify({
          success: false,
          error: {
            code: 'SUBSCRIPTION_EXISTS',
            message: 'Account already has an active subscription',
          },
        }),
      ),
    });

    await expect(
      service.createWorkspaceCheckout(
        '72ecfcd7-d495-43a4-8b8a-8fda2d9cec14',
        'price_pro_monthly',
      ),
    ).rejects.toMatchObject<HttpException>({
      message: 'Account already has an active subscription',
    });
  });

  it('throws ServiceUnavailableException for upstream 5xx responses', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 502,
      text: jest.fn<any>().mockResolvedValue(
        JSON.stringify({
          success: false,
          error: { message: 'Stripe gateway failed' },
        }),
      ),
    });

    await expect(
      service.getWorkspaceSubscription('72ecfcd7-d495-43a4-8b8a-8fda2d9cec14'),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
