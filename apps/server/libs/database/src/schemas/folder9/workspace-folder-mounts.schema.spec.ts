/**
 * Structural smoke tests for workspace_folder_mounts.
 *
 * The session scope stores the full team9 sessionId in scope_id. Real
 * sessionIds include tenantId + agentId + scope + channel/topic/routine id,
 * so the column must be wider than a single UUID-shaped identifier.
 */
import { describe, expect, it } from '@jest/globals';
import * as schema from '../index.js';

describe('workspace_folder_mounts schema', () => {
  it('allows full team9 sessionIds in scopeId', () => {
    const maxObservedSessionIdLength =
      'team9/019c23cb-7920-7742-bd40-abb445d1c8eb/common-staff-019dc2ac-655e-7189-82d3-171e26bb1223/dm/019ddd76-5b08-7551-9a9e-92739dd89d22'
        .length;
    const configuredLength = (
      schema.workspaceFolderMounts.scopeId as unknown as {
        config: { length: number };
      }
    ).config.length;

    expect(configuredLength).toBeGreaterThanOrEqual(maxObservedSessionIdLength);
  });
});
