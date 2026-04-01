import 'reflect-metadata';
import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { WorkspaceBillingController } from './workspace-billing.controller.js';
import { BillingHubService } from '../billing-hub/billing-hub.service.js';
import { WORKSPACE_ROLES_KEY } from './guards/workspace-role.guard.js';

describe('WorkspaceBillingController', () => {
  let controller: WorkspaceBillingController;
  let billingHubService: {
    listSubscriptionProducts: jest.Mock<any>;
    getWorkspaceSubscription: jest.Mock<any>;
    createWorkspaceCheckout: jest.Mock<any>;
    createWorkspacePortal: jest.Mock<any>;
  };

  beforeEach(() => {
    billingHubService = {
      listSubscriptionProducts: jest.fn<any>().mockResolvedValue([]),
      getWorkspaceSubscription: jest.fn<any>().mockResolvedValue(null),
      createWorkspaceCheckout: jest.fn<any>().mockResolvedValue({
        checkoutUrl: 'https://checkout.stripe.com/session',
        sessionId: 'cs_test',
      }),
      createWorkspacePortal: jest.fn<any>().mockResolvedValue({
        portalUrl: 'https://billing.stripe.com/session',
      }),
    };

    controller = new WorkspaceBillingController(
      billingHubService as unknown as BillingHubService,
    );
  });

  it('returns managementAllowed=true for owner and admin roles', async () => {
    await expect(
      controller.getSubscription('72ecfcd7-d495-43a4-8b8a-8fda2d9cec14', {
        workspaceRole: 'owner',
      }),
    ).resolves.toEqual({
      subscription: null,
      managementAllowed: true,
    });

    await expect(
      controller.getSubscription('72ecfcd7-d495-43a4-8b8a-8fda2d9cec14', {
        workspaceRole: 'admin',
      }),
    ).resolves.toEqual({
      subscription: null,
      managementAllowed: true,
    });
  });

  it('returns managementAllowed=false for member roles', async () => {
    await expect(
      controller.getSubscription('72ecfcd7-d495-43a4-8b8a-8fda2d9cec14', {
        workspaceRole: 'member',
      }),
    ).resolves.toEqual({
      subscription: null,
      managementAllowed: false,
    });
  });

  it('delegates checkout creation to BillingHubService', async () => {
    await controller.createCheckout('72ecfcd7-d495-43a4-8b8a-8fda2d9cec14', {
      priceId: 'price_pro_monthly',
    });

    expect(billingHubService.createWorkspaceCheckout).toHaveBeenCalledWith(
      '72ecfcd7-d495-43a4-8b8a-8fda2d9cec14',
      'price_pro_monthly',
    );
  });

  it('marks checkout and portal endpoints as owner/admin only', () => {
    expect(
      Reflect.getMetadata(
        WORKSPACE_ROLES_KEY,
        WorkspaceBillingController.prototype.createCheckout,
      ),
    ).toEqual(['owner', 'admin']);

    expect(
      Reflect.getMetadata(
        WORKSPACE_ROLES_KEY,
        WorkspaceBillingController.prototype.createPortal,
      ),
    ).toEqual(['owner', 'admin']);
  });
});
