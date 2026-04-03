import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockNavigate = vi.hoisted(() => vi.fn());
const mockWorkspaceStore = vi.hoisted(() => vi.fn());
const mockUseUserWorkspaces = vi.hoisted(() => vi.fn());
const mockUseWorkspaceBillingOverview = vi.hoisted(() => vi.fn());
const mockUseCreateWorkspaceBillingCheckout = vi.hoisted(() => vi.fn());
const mockUseCreateWorkspaceBillingPortal = vi.hoisted(() => vi.fn());
const mockOpenExternalUrl = vi.hoisted(() => vi.fn());
const mockCheckoutMutateAsync = vi.hoisted(() => vi.fn());
const mockPortalMutateAsync = vi.hoisted(() => vi.fn());

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock("@/stores", () => ({
  useWorkspaceStore: mockWorkspaceStore,
}));

vi.mock("@/hooks/useWorkspace", () => ({
  useUserWorkspaces: mockUseUserWorkspaces,
}));

vi.mock("@/hooks/useWorkspaceBilling", () => ({
  useWorkspaceBillingOverview: mockUseWorkspaceBillingOverview,
  useCreateWorkspaceBillingCheckout: mockUseCreateWorkspaceBillingCheckout,
  useCreateWorkspaceBillingPortal: mockUseCreateWorkspaceBillingPortal,
}));

vi.mock("@/lib/open-external-url", () => ({
  openExternalUrl: mockOpenExternalUrl,
}));

import { SubscriptionContent } from "../SubscriptionContent";

describe("SubscriptionContent", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockWorkspaceStore.mockReturnValue({
      selectedWorkspaceId: "ws-1",
    });

    mockUseUserWorkspaces.mockReturnValue({
      data: [{ id: "ws-1", name: "Alpha", role: "owner" }],
      isLoading: false,
    });

    mockUseCreateWorkspaceBillingCheckout.mockReturnValue({
      mutateAsync: mockCheckoutMutateAsync,
      isPending: false,
      error: null,
    });

    mockUseCreateWorkspaceBillingPortal.mockReturnValue({
      mutateAsync: mockPortalMutateAsync,
      isPending: false,
      error: null,
    });
  });

  it("renders the simplified plan view and starts subscription checkout", async () => {
    mockUseWorkspaceBillingOverview.mockReturnValue({
      data: {
        account: {
          id: "acct_1",
          ownerExternalId: "tenant:ws-1",
          ownerType: "organization",
          ownerName: "Alpha",
          balance: 3000,
          quota: 0,
          quotaExpiresAt: null,
          effectiveQuota: 0,
          available: 3000,
          creditLimit: 0,
          status: "active",
          metadata: null,
          createdAt: "2026-04-01T00:00:00.000Z",
          updatedAt: "2026-04-01T00:00:00.000Z",
        },
        subscription: null,
        subscriptionProducts: [
          {
            stripePriceId: "price_starter",
            name: "Starter",
            type: "subscription",
            credits: 8000,
            amountCents: 4000,
            interval: "month",
            intervalCount: 1,
            active: true,
            metadata: null,
            display: {
              badge: "Starter",
              description: "Best for consistent workspace usage.",
              features: ["8,000 monthly credits", "Priority support"],
              sortOrder: 1,
            },
          },
          {
            stripePriceId: "price_pro",
            name: "Pro",
            type: "subscription",
            credits: 40000,
            amountCents: 20000,
            interval: "month",
            intervalCount: 1,
            active: true,
            metadata: null,
            display: {
              badge: "Pro",
              description: "Best for sustained team usage.",
              features: ["40,000 monthly credits", "Advanced controls"],
              sortOrder: 2,
            },
          },
        ],
        creditProducts: [],
        recentTransactions: [],
      },
      isLoading: false,
      error: null,
    });

    mockCheckoutMutateAsync.mockResolvedValue({
      checkoutUrl: "https://checkout.stripe.com/pay/cs_plan",
      sessionId: "cs_plan",
    });

    render(<SubscriptionContent />);

    expect(await screen.findByText(/choose your plan/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /choose starter/i }));

    await waitFor(() =>
      expect(mockCheckoutMutateAsync).toHaveBeenCalledWith({
        priceId: "price_starter",
        type: "subscription",
        view: "plans",
        amountCents: undefined,
      }),
    );
    expect(mockOpenExternalUrl).toHaveBeenCalledWith(
      "https://checkout.stripe.com/pay/cs_plan",
    );
  });

  it("keeps starter before pro even when the current plan badge differs", async () => {
    mockUseWorkspaceBillingOverview.mockReturnValue({
      data: {
        account: {
          id: "acct_1",
          ownerExternalId: "tenant:ws-1",
          ownerType: "organization",
          ownerName: "Alpha",
          balance: 3000,
          quota: 8000,
          quotaExpiresAt: "2026-05-01T00:00:00.000Z",
          effectiveQuota: 8000,
          available: 11000,
          creditLimit: 0,
          status: "active",
          metadata: null,
          createdAt: "2026-04-01T00:00:00.000Z",
          updatedAt: "2026-04-01T00:00:00.000Z",
        },
        subscription: {
          stripeSubscriptionId: "sub_123",
          status: "active",
          currentPeriodStart: "2026-04-01T00:00:00.000Z",
          currentPeriodEnd: "2026-05-01T00:00:00.000Z",
          cancelAtPeriodEnd: false,
          product: {
            stripePriceId: "price_starter",
            name: "Starter",
            type: "subscription",
            credits: 8000,
            amountCents: 4000,
            interval: "month",
            intervalCount: 1,
            active: true,
            metadata: null,
            display: {
              badge: "Current",
              description: "Best for consistent workspace usage.",
              features: ["Priority support"],
              sortOrder: 10,
            },
          },
        },
        subscriptionProducts: [
          {
            stripePriceId: "price_pro",
            name: "Pro",
            type: "subscription",
            credits: 40000,
            amountCents: 20000,
            interval: "month",
            intervalCount: 1,
            active: true,
            metadata: null,
            display: {
              badge: "Popular",
              description: "Best for sustained team usage.",
              features: ["Advanced controls"],
              sortOrder: 1,
            },
          },
        ],
        creditProducts: [],
        recentTransactions: [],
      },
      isLoading: false,
      error: null,
    });

    render(<SubscriptionContent />);

    const starterLabel = await screen.findByText("Starter");
    const proLabel = screen.getByText("Pro");

    expect(
      starterLabel.compareDocumentPosition(proLabel) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("renders custom amount top-up and sends amountCents to checkout", async () => {
    mockUseWorkspaceBillingOverview.mockReturnValue({
      data: {
        account: {
          id: "acct_1",
          ownerExternalId: "tenant:ws-1",
          ownerType: "organization",
          ownerName: "Alpha",
          balance: 12000,
          quota: 8000,
          quotaExpiresAt: "2026-05-01T00:00:00.000Z",
          effectiveQuota: 8000,
          available: 20000,
          creditLimit: 0,
          status: "active",
          metadata: null,
          createdAt: "2026-04-01T00:00:00.000Z",
          updatedAt: "2026-04-01T00:00:00.000Z",
        },
        subscription: {
          stripeSubscriptionId: "sub_123",
          status: "active",
          currentPeriodStart: "2026-04-01T00:00:00.000Z",
          currentPeriodEnd: "2026-05-01T00:00:00.000Z",
          cancelAtPeriodEnd: false,
          product: {
            stripePriceId: "price_starter",
            name: "Starter",
            type: "subscription",
            credits: 8000,
            amountCents: 4000,
            interval: "month",
            intervalCount: 1,
            active: true,
            metadata: null,
            display: {
              badge: "Starter",
              description: "Monthly workspace credits",
              features: ["Priority support"],
              sortOrder: 1,
            },
          },
        },
        subscriptionProducts: [],
        creditProducts: [
          {
            stripePriceId: "price_open_topup",
            name: "Open Top-up",
            type: "one_time",
            credits: 10000,
            amountCents: 1000,
            interval: null,
            intervalCount: null,
            active: true,
            metadata: null,
            customAmount: {
              enabled: true,
              minimumCents: 500,
              maximumCents: 50000,
              presetCents: 2500,
            },
            display: {
              description: "Choose any amount for prepaid workspace credits.",
              features: [],
              sortOrder: 1,
            },
          },
          {
            stripePriceId: "price_pack_25",
            name: "Workspace Pack",
            type: "one_time",
            credits: 25000,
            amountCents: 2500,
            interval: null,
            intervalCount: null,
            active: true,
            metadata: null,
            display: {
              description: "Prepaid workspace credits",
              features: [],
              sortOrder: 2,
            },
          },
        ],
        recentTransactions: [],
      },
      isLoading: false,
      error: null,
    });

    mockCheckoutMutateAsync.mockResolvedValue({
      checkoutUrl: "https://checkout.stripe.com/pay/cs_custom",
      sessionId: "cs_custom",
    });

    render(<SubscriptionContent view="credits" />);

    expect(await screen.findByText(/amount in usd/i)).toBeInTheDocument();
    expect(screen.getByDisplayValue("25")).toBeInTheDocument();

    fireEvent.change(screen.getByDisplayValue("25"), {
      target: { value: "55" },
    });

    expect(screen.getByText("55,000 credits")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^add credits$/i }));

    await waitFor(() =>
      expect(mockCheckoutMutateAsync).toHaveBeenCalledWith({
        priceId: "price_open_topup",
        type: "one_time",
        view: "credits",
        amountCents: 5500,
      }),
    );
    expect(mockOpenExternalUrl).toHaveBeenCalledWith(
      "https://checkout.stripe.com/pay/cs_custom",
    );
  });

  it("keeps fixed credit packs as quick amount buttons", async () => {
    mockUseWorkspaceBillingOverview.mockReturnValue({
      data: {
        account: {
          id: "acct_1",
          ownerExternalId: "tenant:ws-1",
          ownerType: "organization",
          ownerName: "Alpha",
          balance: 12000,
          quota: 8000,
          quotaExpiresAt: "2026-05-01T00:00:00.000Z",
          effectiveQuota: 8000,
          available: 20000,
          creditLimit: 0,
          status: "active",
          metadata: null,
          createdAt: "2026-04-01T00:00:00.000Z",
          updatedAt: "2026-04-01T00:00:00.000Z",
        },
        subscription: null,
        subscriptionProducts: [],
        creditProducts: [
          {
            stripePriceId: "price_open_topup",
            name: "Open Top-up",
            type: "one_time",
            credits: 10000,
            amountCents: 1000,
            interval: null,
            intervalCount: null,
            active: true,
            metadata: null,
            customAmount: {
              enabled: true,
              minimumCents: 500,
              maximumCents: 50000,
              presetCents: 2500,
            },
            display: {
              description: "Choose any amount.",
              features: [],
              sortOrder: 1,
            },
          },
          {
            stripePriceId: "price_pack_25",
            name: "Workspace Pack",
            type: "one_time",
            credits: 25000,
            amountCents: 2500,
            interval: null,
            intervalCount: null,
            active: true,
            metadata: null,
            display: {
              description: "Prepaid workspace credits",
              features: [],
              sortOrder: 2,
            },
          },
        ],
        recentTransactions: [],
      },
      isLoading: false,
      error: null,
    });

    mockCheckoutMutateAsync.mockResolvedValue({
      checkoutUrl: "https://checkout.stripe.com/pay/cs_pack",
      sessionId: "cs_pack",
    });

    render(<SubscriptionContent view="credits" />);

    fireEvent.click(await screen.findByRole("button", { name: /add \$25/i }));

    await waitFor(() =>
      expect(mockCheckoutMutateAsync).toHaveBeenCalledWith({
        priceId: "price_pack_25",
        type: "one_time",
        view: "credits",
        amountCents: undefined,
      }),
    );
  });

  it("falls back to fixed packs when custom amount is unavailable", async () => {
    mockUseWorkspaceBillingOverview.mockReturnValue({
      data: {
        account: {
          id: "acct_1",
          ownerExternalId: "tenant:ws-1",
          ownerType: "organization",
          ownerName: "Alpha",
          balance: 12000,
          quota: 0,
          quotaExpiresAt: null,
          effectiveQuota: 0,
          available: 12000,
          creditLimit: 0,
          status: "active",
          metadata: null,
          createdAt: "2026-04-01T00:00:00.000Z",
          updatedAt: "2026-04-01T00:00:00.000Z",
        },
        subscription: null,
        subscriptionProducts: [],
        creditProducts: [
          {
            stripePriceId: "price_pack_25",
            name: "Workspace Pack",
            type: "one_time",
            credits: 25000,
            amountCents: 2500,
            interval: null,
            intervalCount: null,
            active: true,
            metadata: null,
            display: {
              description: "Prepaid workspace credits",
              features: [],
              sortOrder: 1,
            },
          },
        ],
        recentTransactions: [],
      },
      isLoading: false,
      error: null,
    });

    render(<SubscriptionContent view="credits" />);

    expect(
      await screen.findByText(/custom amount top-up is not configured/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/amount in usd/i)).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /add \$25/i }),
    ).toBeInTheDocument();
  });

  it("opens billing management from the simplified plan page", async () => {
    mockUseWorkspaceBillingOverview.mockReturnValue({
      data: {
        account: {
          id: "acct_1",
          ownerExternalId: "tenant:ws-1",
          ownerType: "organization",
          ownerName: "Alpha",
          balance: 5000,
          quota: 8000,
          quotaExpiresAt: "2026-05-01T00:00:00.000Z",
          effectiveQuota: 8000,
          available: 13000,
          creditLimit: 0,
          status: "active",
          metadata: null,
          createdAt: "2026-04-01T00:00:00.000Z",
          updatedAt: "2026-04-01T00:00:00.000Z",
        },
        subscription: {
          stripeSubscriptionId: "sub_123",
          status: "active",
          currentPeriodStart: "2026-04-01T00:00:00.000Z",
          currentPeriodEnd: "2026-05-01T00:00:00.000Z",
          cancelAtPeriodEnd: true,
          product: {
            stripePriceId: "price_starter",
            name: "Starter",
            type: "subscription",
            credits: 8000,
            amountCents: 4000,
            interval: "month",
            intervalCount: 1,
            active: true,
            metadata: null,
            display: {
              badge: "Current",
              description: "Monthly workspace credits",
              features: ["Priority support"],
              sortOrder: 1,
            },
          },
        },
        subscriptionProducts: [],
        creditProducts: [],
        recentTransactions: [],
      },
      isLoading: false,
      error: null,
    });

    mockPortalMutateAsync.mockResolvedValue({
      portalUrl: "https://billing.stripe.com/session",
    });

    render(<SubscriptionContent />);

    expect(screen.getByText(/will end on/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /manage billing/i }));

    await waitFor(() =>
      expect(mockPortalMutateAsync).toHaveBeenCalledWith({ view: "plans" }),
    );
    expect(mockOpenExternalUrl).toHaveBeenCalledWith(
      "https://billing.stripe.com/session",
    );
  });

  it("blocks members from the billing page", async () => {
    mockUseUserWorkspaces.mockReturnValue({
      data: [{ id: "ws-1", name: "Alpha", role: "member" }],
      isLoading: false,
    });

    mockUseWorkspaceBillingOverview.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: null,
    });

    render(<SubscriptionContent />);

    expect(
      await screen.findByText(/billing access required/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /manage workspace credits/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /open billing portal/i }),
    ).not.toBeInTheDocument();
  });
});
