import {
  HttpException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { env } from '@team9/shared';

interface BillingHubSuccessResponse<T> {
  success: true;
  data: T;
}

interface BillingHubErrorResponse {
  success: false;
  error?: {
    code?: string;
    message?: string;
    details?: unknown;
  };
}

interface BillingProductDisplay {
  badge?: string;
  description?: string;
  features: string[];
  sortOrder: number;
}

export interface BillingProduct {
  id?: string;
  stripePriceId: string;
  stripeProductId?: string;
  name: string;
  type?: 'subscription' | 'one_time';
  credits?: number;
  amountCents: number;
  interval: string | null;
  active: boolean;
  sortOrder?: number;
  display: BillingProductDisplay;
}

export interface WorkspaceSubscription {
  id?: string;
  stripeSubscriptionId: string;
  status: string;
  product: BillingProduct;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
}

export interface CheckoutSessionResponse {
  checkoutUrl: string;
  sessionId: string;
}

export interface BillingPortalResponse {
  portalUrl: string;
}

@Injectable()
export class BillingHubService {
  private readonly logger = new Logger(BillingHubService.name);

  private ownerExternalId(workspaceId: string) {
    return `tenant:${workspaceId}`;
  }

  async listSubscriptionProducts(): Promise<BillingProduct[]> {
    return this.request<BillingProduct[]>(
      '/api/billing/stripe/products?type=subscription',
      { method: 'GET' },
    );
  }

  async getWorkspaceSubscription(
    workspaceId: string,
  ): Promise<WorkspaceSubscription | null> {
    const ownerExternalId = encodeURIComponent(
      this.ownerExternalId(workspaceId),
    );
    const response = await this.request<{
      subscription: WorkspaceSubscription | null;
    }>(`/api/billing/stripe/subscription?ownerExternalId=${ownerExternalId}`, {
      method: 'GET',
    });

    return response.subscription;
  }

  async createWorkspaceCheckout(
    workspaceId: string,
    priceId: string,
  ): Promise<CheckoutSessionResponse> {
    return this.request<CheckoutSessionResponse>(
      '/api/billing/stripe/checkout/subscription',
      {
        method: 'POST',
        body: JSON.stringify({
          ownerExternalId: this.ownerExternalId(workspaceId),
          priceId,
          successUrl: `${env.APP_URL}/subscription?workspaceId=${workspaceId}&result=success`,
          cancelUrl: `${env.APP_URL}/subscription?workspaceId=${workspaceId}&result=cancel`,
        }),
      },
    );
  }

  async createWorkspacePortal(
    workspaceId: string,
  ): Promise<BillingPortalResponse> {
    return this.request<BillingPortalResponse>('/api/billing/stripe/portal', {
      method: 'POST',
      body: JSON.stringify({
        ownerExternalId: this.ownerExternalId(workspaceId),
        returnUrl: `${env.APP_URL}/subscription?workspaceId=${workspaceId}`,
      }),
    });
  }

  private async request<T>(
    path: string,
    init: RequestInit,
    timeoutMs = 10000,
  ): Promise<T> {
    const url = new URL(path, env.BILLING_HUB_BASE_URL).toString();
    const startTime = Date.now();

    try {
      const response = await fetch(url, {
        ...init,
        headers: {
          'Content-Type': 'application/json',
          'X-Service-Key': env.BILLING_HUB_SERVICE_KEY,
          ...(init.headers ?? {}),
        },
        signal: AbortSignal.timeout(timeoutMs),
      });

      const elapsed = Date.now() - startTime;
      const text = await response.text();
      const payload = text
        ? (JSON.parse(text) as
            | BillingHubSuccessResponse<T>
            | BillingHubErrorResponse)
        : null;

      if (!response.ok) {
        const message =
          (payload && 'error' in payload && payload.error?.message) ||
          `Billing Hub request failed with status ${response.status}`;

        this.logger.error(
          `Billing Hub API error: ${init.method ?? 'GET'} ${path} responded ${response.status} in ${elapsed}ms — ${message}`,
        );

        if (response.status >= 500) {
          throw new ServiceUnavailableException('Billing Hub is unavailable');
        }

        throw new HttpException(
          {
            message,
            code:
              payload && 'error' in payload ? payload.error?.code : undefined,
          },
          response.status,
        );
      }

      this.logger.debug(
        `Billing Hub API: ${init.method ?? 'GET'} ${path} -> ${response.status} in ${elapsed}ms`,
      );

      if (!payload || !('data' in payload)) {
        throw new ServiceUnavailableException(
          'Billing Hub returned an invalid response',
        );
      }

      return payload.data;
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }

      if (error instanceof Error && error.name === 'TimeoutError') {
        this.logger.error(
          `Billing Hub API timeout: ${init.method ?? 'GET'} ${path} after ${timeoutMs}ms`,
        );
        throw new ServiceUnavailableException('Billing Hub is not responding');
      }

      this.logger.error(
        `Billing Hub API fetch failed: ${init.method ?? 'GET'} ${path} — ${error instanceof Error ? error.message : String(error)}`,
      );
      throw new ServiceUnavailableException('Billing Hub is unreachable');
    }
  }
}
