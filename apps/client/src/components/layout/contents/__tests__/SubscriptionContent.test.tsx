import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockWorkspaceStore = vi.hoisted(() => vi.fn());
const mockUseUserWorkspaces = vi.hoisted(() => vi.fn());
const mockUseWorkspaceBillingSummary = vi.hoisted(() => vi.fn());
const mockUseWorkspaceBillingProducts = vi.hoisted(() => vi.fn());
const mockUseCreateWorkspaceBillingCheckout = vi.hoisted(() => vi.fn());
const mockUseCreateWorkspaceBillingPortal = vi.hoisted(() => vi.fn());
const mockOpenExternalUrl = vi.hoisted(() => vi.fn());
const mockCheckoutMutateAsync = vi.hoisted(() => vi.fn());
const mockPortalMutateAsync = vi.hoisted(() => vi.fn());

vi.mock("@/stores", () => ({
  useWorkspaceStore: mockWorkspaceStore,
}));

vi.mock("@/hooks/useWorkspace", () => ({
  useUserWorkspaces: mockUseUserWorkspaces,
}));

vi.mock("@/hooks/useWorkspaceBilling", () => ({
  useWorkspaceBillingSummary: mockUseWorkspaceBillingSummary,
  useWorkspaceBillingProducts: mockUseWorkspaceBillingProducts,
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

  it("renders subscription products and starts checkout for managers", async () => {
    mockUseWorkspaceBillingSummary.mockReturnValue({
      data: { subscription: null, managementAllowed: true },
      isLoading: false,
      error: null,
    });

    mockUseWorkspaceBillingProducts.mockReturnValue({
      data: [
        {
          stripePriceId: "price_pro",
          name: "Team9 Pro",
          amountCents: 2900,
          interval: "month",
          active: true,
          display: {
            badge: "Popular",
            description: "Built for active teams",
            features: ["Unlimited history", "Priority support"],
            sortOrder: 1,
          },
        },
      ],
      isLoading: false,
    });

    mockCheckoutMutateAsync.mockResolvedValue({
      checkoutUrl: "https://checkout.stripe.com/pay/cs_test",
      sessionId: "cs_test",
    });

    render(<SubscriptionContent />);

    expect(await screen.findByText("Team9 Pro")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /subscribe/i }));

    await waitFor(() =>
      expect(mockCheckoutMutateAsync).toHaveBeenCalledWith({
        priceId: "price_pro",
      }),
    );
    expect(mockOpenExternalUrl).toHaveBeenCalledWith(
      "https://checkout.stripe.com/pay/cs_test",
    );
  });

  it("renders current subscription state and opens billing portal", async () => {
    mockUseWorkspaceBillingSummary.mockReturnValue({
      data: {
        managementAllowed: true,
        subscription: {
          stripeSubscriptionId: "sub_123",
          status: "active",
          currentPeriodStart: "2026-04-01T00:00:00.000Z",
          currentPeriodEnd: "2026-05-01T00:00:00.000Z",
          cancelAtPeriodEnd: true,
          product: {
            stripePriceId: "price_pro",
            name: "Team9 Pro",
            amountCents: 2900,
            interval: "month",
            active: true,
            display: {
              badge: "Recommended",
              description: "Built for active teams",
              features: ["Unlimited history", "Priority support"],
              sortOrder: 1,
            },
          },
        },
      },
      isLoading: false,
      error: null,
    });

    mockUseWorkspaceBillingProducts.mockReturnValue({
      data: [],
      isLoading: false,
    });

    mockPortalMutateAsync.mockResolvedValue({
      portalUrl: "https://billing.stripe.com/session",
    });

    render(<SubscriptionContent result="success" />);

    expect(await screen.findByText(/checkout completed/i)).toBeInTheDocument();
    expect(screen.getByText(/will cancel at the end/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /manage billing/i }));

    await waitFor(() => expect(mockPortalMutateAsync).toHaveBeenCalled());
    expect(mockOpenExternalUrl).toHaveBeenCalledWith(
      "https://billing.stripe.com/session",
    );
  });

  it("shows read-only messaging and hides actions for non-managers", async () => {
    mockUseWorkspaceBillingSummary.mockReturnValue({
      data: { subscription: null, managementAllowed: false },
      isLoading: false,
      error: null,
    });

    mockUseWorkspaceBillingProducts.mockReturnValue({
      data: [
        {
          stripePriceId: "price_pro",
          name: "Team9 Pro",
          amountCents: 2900,
          interval: "month",
          active: true,
          display: {
            features: ["Unlimited history"],
            sortOrder: 1,
          },
        },
      ],
      isLoading: false,
    });

    render(<SubscriptionContent result="cancel" />);

    expect(
      await screen.findByText(/checkout was canceled/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/read-only access/i)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /subscribe/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /manage billing/i }),
    ).not.toBeInTheDocument();
  });
});
