import { describe, it, expect } from '@jest/globals';
import { HealthController } from './health.controller.js';

describe('HealthController', () => {
  it('returns ok status', () => {
    const controller = new HealthController();

    expect(controller.check()).toEqual({ status: 'ok' });
  });
});
