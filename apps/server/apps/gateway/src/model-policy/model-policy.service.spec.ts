import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { HttpException } from '@nestjs/common';
import { appMetrics } from '@team9/observability';
import {
  getDefaultStaffModel,
  STAFF_MODEL_CATALOG,
  validateStaffModelCatalog,
} from './staff-model-catalog.js';
import { ModelPolicyService } from './model-policy.service.js';

function errorCode(error: unknown): string | undefined {
  if (!(error instanceof HttpException)) return undefined;
  const response = error.getResponse();
  return typeof response === 'object' && response !== null
    ? String((response as { code?: unknown }).code)
    : undefined;
}

describe('ModelPolicyService', () => {
  const service = new ModelPolicyService();

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('resolves provisioning defaults from the validated server catalog', () => {
    expect(getDefaultStaffModel('staff')).toMatchObject({
      provider: 'openrouter',
      default: true,
      capabilities: ['staff'],
    });
  });

  it.each(STAFF_MODEL_CATALOG)(
    'accepts the exact $provider/$id staff catalog pair',
    (entry) => {
      expect(
        service.assertModelAllowed('staff', {
          provider: entry.provider,
          id: entry.id,
        }),
      ).toMatchObject({
        provider: entry.provider,
        id: entry.id,
        capability: 'staff',
      });
    },
  );

  it.each([
    { provider: 'custom', id: 'gpt-4' },
    { provider: 'anthropic', id: 'claude-3-opus' },
    { provider: 'http://evil.com', id: 'test' },
    { provider: 'openrouter', id: 'openai/gpt-5.5\n' },
    { provider: 'openrouter', id: 'openai/gpt-5.5\u0000' },
    { provider: 'openrouter', id: 'unknown/model' },
  ])('rejects unsupported or unsafe pair %#', (model) => {
    expect.assertions(1);
    try {
      service.assertModelAllowed('staff', model);
    } catch (error) {
      expect(errorCode(error)).toBe('unsupported_model');
    }
  });

  it('trims harmless surrounding spaces without changing model identity', () => {
    const approved = service.assertModelAllowed('staff', {
      provider: ' openrouter ',
      id: ' anthropic/claude-sonnet-4.6 ',
    });

    expect(approved).toMatchObject({
      provider: 'openrouter',
      id: 'anthropic/claude-sonnet-4.6',
    });
  });

  it.each(['common-staff', 'personal-staff'])(
    'allows dynamic switching for %s',
    (applicationId) => {
      expect(service.assertDynamicSwitchAllowed(applicationId)).toBe('staff');
    },
  );

  it.each(['base-model-staff', 'base-model-chatgpt', 'unknown', '', null])(
    'fails closed for application identity %p',
    (applicationId) => {
      expect.assertions(1);
      try {
        service.assertDynamicSwitchAllowed(applicationId);
      } catch (error) {
        expect(errorCode(error)).toBe('model_switch_not_allowed');
      }
    },
  );

  it('emits bounded fixed-bot and unsupported-pair counters', () => {
    const fixedAdd = jest.fn();
    const unsupportedAdd = jest.fn();
    jest
      .spyOn(appMetrics, 'modelChangeFixedBotRejectionsTotal', 'get')
      .mockReturnValue({ add: fixedAdd } as never);
    jest
      .spyOn(appMetrics, 'modelChangeUnsupportedTotal', 'get')
      .mockReturnValue({ add: unsupportedAdd } as never);

    expect(() =>
      service.assertDynamicSwitchAllowed('base-model-staff'),
    ).toThrow();
    expect(() =>
      service.assertModelAllowed('staff', {
        provider: 'attacker-controlled-provider',
        id: 'unknown/model',
      }),
    ).toThrow();

    expect(fixedAdd).toHaveBeenCalledWith(1, {
      application: 'base-model',
    });
    expect(unsupportedAdd).toHaveBeenCalledWith(1, {
      capability: 'staff',
      provider: 'other',
    });
  });

  it('rejects duplicate pairs, multiple defaults, and unsafe entries', () => {
    expect(() =>
      validateStaffModelCatalog([
        ...STAFF_MODEL_CATALOG,
        STAFF_MODEL_CATALOG[0],
      ]),
    ).toThrow(/duplicate/i);

    expect(() =>
      validateStaffModelCatalog(
        STAFF_MODEL_CATALOG.map((entry) => ({ ...entry, default: true })),
      ),
    ).toThrow(/default/i);

    expect(() =>
      validateStaffModelCatalog([
        {
          ...STAFF_MODEL_CATALOG[0],
          id: 'https://evil.example/model',
        },
      ]),
    ).toThrow(/unsafe/i);
  });
});
