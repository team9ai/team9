import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import { changeLanguage } from "@/i18n/loadLanguage";

const mockNavigate = vi.hoisted(() => vi.fn());
const mockWorkspaceStore = vi.hoisted(() => vi.fn());
const mockUseUserWorkspaces = vi.hoisted(() => vi.fn());
const mockUseWorkspaceBillingOverview = vi.hoisted(() => vi.fn());
const mockUseWorkspaceBillingTransactions = vi.hoisted(() => vi.fn());
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
  useWorkspaceBillingTransactions: mockUseWorkspaceBillingTransactions,
  useCreateWorkspaceBillingCheckout: mockUseCreateWorkspaceBillingCheckout,
  useCreateWorkspaceBillingPortal: mockUseCreateWorkspaceBillingPortal,
}));

vi.mock("@/lib/open-external-url", () => ({
  openExternalUrl: mockOpenExternalUrl,
}));

import { SubscriptionContent } from "../SubscriptionContent";

describe("SubscriptionContent", () => {
  beforeEach(async () => {
    vi.clearAllMocks();

    if (i18n.language !== "en") {
      await changeLanguage("en");
    }

    mockWorkspaceStore.mockReturnValue({
      selectedWorkspaceId: "ws-1",
    });

    mockUseUserWorkspaces.mockReturnValue({
      data: [{ id: "ws-1", name: "Alpha", role: "owner" }],
      isLoading: false,
    });

    mockUseWorkspaceBillingTransactions.mockReturnValue({
      data: { transactions: [], total: 0, page: 1, limit: 10 },
      isLoading: false,
      isError: false,
      isFetching: false,
      error: null,
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
          grantBalance: 0,
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
          grantBalance: 0,
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

  it("renders plus before pro on the plan page", async () => {
    mockUseWorkspaceBillingOverview.mockReturnValue({
      data: {
        account: {
          id: "acct_1",
          ownerExternalId: "tenant:ws-1",
          ownerType: "organization",
          ownerName: "Alpha",
          balance: 3000,
          grantBalance: 0,
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
            stripePriceId: "price_pro",
            name: "Pro Plan",
            type: "subscription",
            credits: 200000,
            amountCents: 20000,
            interval: "month",
            intervalCount: 1,
            active: true,
            metadata: null,
            display: {
              badge: "Pro Plan",
              description: "Best for sustained team usage.",
              features: ["Advanced controls"],
              sortOrder: 1,
            },
          },
          {
            stripePriceId: "price_plus",
            name: "Plus Plan",
            type: "subscription",
            credits: 40000,
            amountCents: 4000,
            interval: "month",
            intervalCount: 1,
            active: true,
            metadata: null,
            display: {
              badge: "Plus Plan",
              description: "Best for flexible usage.",
              features: ["Shared billing"],
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

    render(<SubscriptionContent />);

    const plusLabel = await screen.findByText("Plus Plan");
    const proLabel = screen.getByText("Pro Plan");

    expect(
      plusLabel.compareDocumentPosition(proLabel) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("renders the updated plan copy in Chinese", async () => {
    await changeLanguage("zh-CN");

    mockUseWorkspaceBillingOverview.mockReturnValue({
      data: {
        account: {
          id: "acct_1",
          ownerExternalId: "tenant:ws-1",
          ownerType: "organization",
          ownerName: "Alpha",
          balance: 3000,
          grantBalance: 0,
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
            stripePriceId: "price_plus",
            name: "Plus Plan",
            type: "subscription",
            credits: 40000,
            amountCents: 4000,
            interval: "month",
            intervalCount: 1,
            active: true,
            metadata: null,
            display: {
              badge: "Plus Plan",
              description: "Best for flexible usage.",
              features: ["Shared billing"],
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

    expect(await screen.findByText("选择你的方案")).toBeInTheDocument();
    expect(screen.getByText("免费版")).toBeInTheDocument();
    expect(screen.getByText("4,000 一次性点数")).toBeInTheDocument();
    expect(screen.getByText("每月 40,000 点数")).toBeInTheDocument();
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
          grantBalance: 1500,
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

    expect(await screen.findByText(/buy credits/i)).toBeInTheDocument();
    expect(screen.getByText("21,500 credits")).toBeInTheDocument();
    expect(screen.getByText("Top-up: 12,000 credits")).toBeInTheDocument();
    expect(screen.getByText("Subscription: 8,000 credits")).toBeInTheDocument();
    expect(screen.getByText("Grant: 1,500 credits")).toBeInTheDocument();
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

  it("does not start fixed-pack checkout without an active subscription", async () => {
    mockUseWorkspaceBillingOverview.mockReturnValue({
      data: {
        account: {
          id: "acct_1",
          ownerExternalId: "tenant:ws-1",
          ownerType: "organization",
          ownerName: "Alpha",
          balance: 12000,
          grantBalance: 0,
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

    expect(mockCheckoutMutateAsync).not.toHaveBeenCalled();
  });

  it("guides unsubscribed users to plans when clicking custom amount Add Credits", async () => {
    mockUseWorkspaceBillingOverview.mockReturnValue({
      data: {
        account: {
          id: "acct_1",
          ownerExternalId: "tenant:ws-1",
          ownerType: "organization",
          ownerName: "Alpha",
          balance: 0,
          grantBalance: 0,
          quota: 0,
          quotaExpiresAt: null,
          effectiveQuota: 0,
          available: 0,
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
        ],
        recentTransactions: [],
      },
      isLoading: false,
      error: null,
    });

    render(<SubscriptionContent view="credits" />);

    expect(
      await screen.findByText(
        /an active subscription is required before buying credits/i,
      ),
    ).toBeInTheDocument();

    // Inline banner's "View Plans" link navigates to the plans view.
    fireEvent.click(screen.getByRole("button", { name: /^view plans$/i }));
    expect(mockNavigate).toHaveBeenCalledWith(
      expect.objectContaining({ to: "/subscription" }),
    );

    mockNavigate.mockClear();

    // Clicking custom-amount Add Credits opens the subscription-required dialog
    // instead of silently doing nothing.
    fireEvent.click(screen.getByRole("button", { name: /^add credits$/i }));

    expect(
      await screen.findByText(/subscription required/i),
    ).toBeInTheDocument();
    expect(mockCheckoutMutateAsync).not.toHaveBeenCalled();
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
          grantBalance: 0,
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
          grantBalance: 0,
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

  it("paginates the credits transaction list and opens the details dialog", async () => {
    mockUseWorkspaceBillingOverview.mockReturnValue({
      data: {
        account: {
          id: "acct_1",
          ownerExternalId: "tenant:ws-1",
          ownerType: "organization",
          ownerName: "Alpha",
          balance: 0,
          grantBalance: 5000,
          quota: 0,
          quotaExpiresAt: null,
          effectiveQuota: 0,
          available: 5000,
          creditLimit: 0,
          status: "active",
          metadata: null,
          createdAt: "2026-04-01T00:00:00.000Z",
          updatedAt: "2026-04-01T00:00:00.000Z",
        },
        subscription: null,
        subscriptionProducts: [],
        creditProducts: [],
        recentTransactions: [],
      },
      isLoading: false,
      error: null,
    });

    mockUseWorkspaceBillingTransactions.mockReturnValue({
      data: {
        transactions: [
          {
            id: "txn_1",
            accountId: "acct_1",
            type: "consume",
            amount: 1.798,
            balanceBefore: 0,
            balanceAfter: 0,
            operatorExternalId: "op-1",
            agentId: "agent-1",
            referenceType: "llm_usage",
            referenceId: "gen-abc-123",
            description: "LLM usage: openai/gpt-5.4-mini via openrouter",
            createdAt: "2026-05-11T06:06:00.000Z",
            productName: null,
            paymentAmountCents: null,
            invoiceId: null,
          },
        ],
        total: 25,
        page: 1,
        limit: 10,
      },
      isLoading: false,
      isError: false,
      isFetching: false,
      error: null,
    });

    render(<SubscriptionContent view="credits" />);

    expect(await screen.findByText("Recent Transactions")).toBeInTheDocument();
    // The always-empty Amount column was removed.
    expect(
      screen.queryByRole("columnheader", { name: /amount/i }),
    ).not.toBeInTheDocument();

    // Pagination: 25 / 10 -> 3 pages, Previous disabled on the first page.
    expect(screen.getByText("Page 1 of 3")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /previous/i })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    expect(screen.getByText("Page 2 of 3")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /previous/i })).toBeEnabled();

    // Clicking a transaction row opens the details dialog with its fields.
    fireEvent.click(
      screen.getByText("LLM usage: openai/gpt-5.4-mini via openrouter", {
        selector: "div",
      }),
    );
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Usage")).toBeInTheDocument();
    expect(within(dialog).getByText("agent-1")).toBeInTheDocument();
    expect(within(dialog).getByText("gen-abc-123")).toBeInTheDocument();
    // Confusing "balance before -> after" row is gone.
    expect(within(dialog).queryByText(/^balance$/i)).not.toBeInTheDocument();
  });
});
