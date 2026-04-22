import {
  BadRequestException,
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

export interface BillingProductCustomAmount {
  enabled: boolean;
  minimumCents?: number | null;
  maximumCents?: number | null;
  presetCents?: number | null;
}

export type BillingProductType = 'subscription' | 'one_time';

export interface BillingProduct {
  id?: string;
  stripePriceId: string;
  stripeProductId?: string;
  name: string;
  type?: BillingProductType;
  credits?: number;
  amountCents: number;
  interval: string | null;
  intervalCount?: number | null;
  active: boolean;
  sortOrder?: number;
  metadata?: Record<string, unknown> | null;
  customAmount?: BillingProductCustomAmount;
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

export interface WorkspaceBillingAccount {
  id: string;
  ownerExternalId: string;
  ownerType: 'personal' | 'organization';
  ownerName: string | null;
  balance: number;
  grantBalance: number;
  quota: number;
  quotaExpiresAt: string | null;
  effectiveQuota: number;
  available: number;
  creditLimit: number;
  status: 'active' | 'frozen';
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

type BillingView = 'plans' | 'credits';

type WorkspaceRole = 'owner' | 'admin' | 'member' | 'guest';

@Injectable()
export class BillingHubService {
  private readonly logger = new Logger(BillingHubService.name);

  private get enabled(): boolean {
    return Boolean(env.BILLING_HUB_BASE_URL && env.BILLING_HUB_SERVICE_KEY);
  }

  private ownerExternalId(workspaceId: string) {
    return `tenant:${workspaceId}`;
  }

  async listProducts(type?: BillingProductType): Promise<BillingProduct[]> {
    if (!this.enabled) return [];
    const query = type ? `?type=${type}` : '';

    return this.request<BillingProduct[]>(
      `/api/billing/stripe/products${query}`,
      { method: 'GET' },
    );
  }

  async listSubscriptionProducts(): Promise<BillingProduct[]> {
    return this.listProducts('subscription');
  }

  async listOneTimeProducts(): Promise<BillingProduct[]> {
    return this.listProducts('one_time');
  }

  async getWorkspaceSubscription(
    workspaceId: string,
  ): Promise<WorkspaceSubscription | null> {
    if (!this.enabled) return null;
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

  async getWorkspaceAccount(
    workspaceId: string,
  ): Promise<WorkspaceBillingAccount | null> {
    if (!this.enabled) return null;
    const ownerExternalId = encodeURIComponent(
      this.ownerExternalId(workspaceId),
    );

    const response = await this.request<{
      account: WorkspaceBillingAccount | null;
    }>(`/api/billing/account?ownerExternalId=${ownerExternalId}`, {
      method: 'GET',
    });

    return response.account;
  }

  async listWorkspaceTransactions(
    workspaceId: string,
    limit = 10,
  ): Promise<WorkspaceBillingTransaction[]> {
    if (!this.enabled) return [];
    const ownerExternalId = encodeURIComponent(
      this.ownerExternalId(workspaceId),
    );

    const response = await this.request<{
      transactions: WorkspaceBillingTransaction[];
    }>(
      `/api/billing/account/transactions?ownerExternalId=${ownerExternalId}&limit=${limit}`,
      {
        method: 'GET',
      },
    );

    return response.transactions;
  }

  async getWorkspaceOverview(
    workspaceId: string,
    role?: WorkspaceRole,
  ): Promise<WorkspaceBillingOverview> {
    // Transaction history carries audit data (invoice IDs, operator IDs)
    // that should stay scoped to billing managers; balance and plan info
    // stay visible to every workspace member.
    const canViewTransactions = role === 'owner' || role === 'admin';

    const [
      account,
      subscription,
      subscriptionProducts,
      creditProducts,
      recentTransactions,
    ] = await Promise.all([
      this.getWorkspaceAccount(workspaceId),
      this.getWorkspaceSubscription(workspaceId),
      this.listSubscriptionProducts(),
      this.listOneTimeProducts(),
      canViewTransactions
        ? this.listWorkspaceTransactions(workspaceId)
        : Promise.resolve<WorkspaceBillingTransaction[]>([]),
    ]);

    return {
      account,
      subscription,
      subscriptionProducts,
      creditProducts,
      recentTransactions,
    };
  }

  async createWorkspaceCheckout(
    workspaceId: string,
    priceId: string,
    type: BillingProductType = 'subscription',
    view: BillingView = 'plans',
    amountCents?: number,
    successPath?: string,
    cancelPath?: string,
    initiatorUserId?: string,
  ): Promise<CheckoutSessionResponse> {
    if (!this.enabled) {
      throw new ServiceUnavailableException('Billing Hub is not configured');
    }
    const checkoutPath =
      type === 'one_time'
        ? '/api/billing/stripe/checkout/one-time'
        : '/api/billing/stripe/checkout/subscription';

    return this.request<CheckoutSessionResponse>(checkoutPath, {
      method: 'POST',
      body: JSON.stringify({
        ownerExternalId: this.ownerExternalId(workspaceId),
        priceId,
        successUrl: this.buildReturnUrl(workspaceId, {
          path: successPath,
          result: 'success',
          view,
        }),
        cancelUrl: this.buildReturnUrl(workspaceId, {
          path: cancelPath,
          result: 'cancel',
          view,
        }),
        ...(amountCents !== undefined ? { amountCents } : {}),
        // Persisted in Stripe session metadata so billing-hub can echo it
        // back when firing the payment-succeeded webhook to team9.
        ...(initiatorUserId ? { metadata: { initiatorUserId } } : {}),
      }),
    });
  }

  async createWorkspacePortal(
    workspaceId: string,
    view: BillingView = 'plans',
    returnPath?: string,
  ): Promise<BillingPortalResponse> {
    if (!this.enabled) {
      throw new ServiceUnavailableException('Billing Hub is not configured');
    }
    return this.request<BillingPortalResponse>('/api/billing/stripe/portal', {
      method: 'POST',
      body: JSON.stringify({
        ownerExternalId: this.ownerExternalId(workspaceId),
        returnUrl: this.buildReturnUrl(workspaceId, {
          path: returnPath,
          view,
        }),
      }),
    });
  }

  async grantCredits(
    workspaceId: string,
    amount: number,
    referenceType: string,
    referenceId: string,
    description?: string,
  ): Promise<void> {
    if (!this.enabled) {
      this.logger.debug(
        `Billing Hub disabled: skipping grantCredits(${workspaceId}, ${amount})`,
      );
      return;
    }
    await this.request('/api/billing/grant', {
      method: 'POST',
      body: JSON.stringify({
        ownerExternalId: this.ownerExternalId(workspaceId),
        amount,
        referenceType,
        referenceId,
        description,
      }),
    });
  }

  private buildReturnUrl(
    workspaceId: string,
    params: {
      path?: string;
      result?: 'success' | 'cancel';
      view?: BillingView;
    } = {},
  ) {
    const url = new URL(params.path ?? '/subscription', env.APP_URL);

    if (url.origin !== new URL(env.APP_URL).origin) {
      throw new BadRequestException(
        'Billing return path must stay on this app',
      );
    }

    url.searchParams.set('workspaceId', workspaceId);

    if (params.result) {
      url.searchParams.set('result', params.result);
    }

    if (params.view && params.view !== 'plans') {
      url.searchParams.set('view', params.view);
    }

    return url.toString();
  }

  private async request<T>(
    path: string,
    init: RequestInit,
    timeoutMs = 10000,
  ): Promise<T> {
    const baseUrl = env.BILLING_HUB_BASE_URL;
    const serviceKey = env.BILLING_HUB_SERVICE_KEY;
    if (!baseUrl || !serviceKey) {
      throw new ServiceUnavailableException('Billing Hub is not configured');
    }
    const url = new URL(path, baseUrl).toString();
    const startTime = Date.now();

    try {
      const response = await fetch(url, {
        ...init,
        headers: {
          'Content-Type': 'application/json',
          'X-Service-Key': serviceKey,
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
