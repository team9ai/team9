/**
 * Wire-contract tests for the internal ahand DTOs.
 *
 * Regression target: `@IsUUID('4')` was rejecting team9 user IDs with
 * "userId must be a UUID" because team9 stores UUIDv7 (time-ordered).
 * Loosening to `@IsUUID()` (any RFC 4122 version) fixed it. These tests
 * pin that contract so we don't accidentally re-introduce a version
 * filter and break the live `/internal/ahand/devices/list-for-user`
 * call from claw-hive-worker.
 */

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  ControlPlaneTokenRequestDto,
  ListDevicesForUserRequestDto,
} from './internal.dto.js';

async function validateDto<T extends object>(
  cls: { new (): T },
  payload: Record<string, unknown>,
): Promise<{ ok: boolean; errors: string[] }> {
  const instance = plainToInstance(cls, payload);
  const errors = await validate(instance);
  return {
    ok: errors.length === 0,
    errors: errors.flatMap((e) => Object.values(e.constraints ?? {})),
  };
}

// Real values pulled from production: claw-hive-worker forwards a
// session.assign team9Context with peerUserId set to the real human's
// row in im_users, which is UUIDv7. Hex digits 13–16 spell `7XYZ` —
// the leading `7` is the version nibble.
const TEAM9_USER_ID_V7 = '019cd29d-4852-748f-ad39-dbc28410914e';
const RANDOM_UUID_V4 = 'b8a4f47a-3d11-4c21-9e02-9f3a06f78c12';
const VALID_DEVICE_ID = 'a'.repeat(64); // 64 hex chars (SHA256 of pubkey)

describe('ListDevicesForUserRequestDto', () => {
  it('accepts a UUIDv7 user id (the live team9 schema)', async () => {
    const result = await validateDto(ListDevicesForUserRequestDto, {
      userId: TEAM9_USER_ID_V7,
    });
    expect(result.ok).toBe(true);
  });

  it('still accepts UUIDv4 (older test fixtures + future-proofing)', async () => {
    const result = await validateDto(ListDevicesForUserRequestDto, {
      userId: RANDOM_UUID_V4,
    });
    expect(result.ok).toBe(true);
  });

  it('rejects a non-UUID string', async () => {
    const result = await validateDto(ListDevicesForUserRequestDto, {
      userId: 'auto', // hive-runtime's sentinel — should never reach the gateway
    });
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toMatch(/userId must be a UUID/);
  });

  it('rejects a missing userId', async () => {
    const result = await validateDto(ListDevicesForUserRequestDto, {});
    expect(result.ok).toBe(false);
  });

  it('accepts includeOffline as an optional boolean', async () => {
    const result = await validateDto(ListDevicesForUserRequestDto, {
      userId: TEAM9_USER_ID_V7,
      includeOffline: true,
    });
    expect(result.ok).toBe(true);
  });

  it('rejects a non-boolean includeOffline', async () => {
    const result = await validateDto(ListDevicesForUserRequestDto, {
      userId: TEAM9_USER_ID_V7,
      includeOffline: 'yes',
    });
    expect(result.ok).toBe(false);
  });
});

describe('ControlPlaneTokenRequestDto', () => {
  it('accepts UUIDv7 + 64-hex deviceIds', async () => {
    const result = await validateDto(ControlPlaneTokenRequestDto, {
      userId: TEAM9_USER_ID_V7,
      deviceIds: [VALID_DEVICE_ID],
    });
    expect(result.ok).toBe(true);
  });

  it('accepts UUIDv7 with no deviceIds (deviceIds is optional)', async () => {
    const result = await validateDto(ControlPlaneTokenRequestDto, {
      userId: TEAM9_USER_ID_V7,
    });
    expect(result.ok).toBe(true);
  });

  it('rejects deviceIds that are not 64-hex strings', async () => {
    const result = await validateDto(ControlPlaneTokenRequestDto, {
      userId: TEAM9_USER_ID_V7,
      deviceIds: ['not-a-hex-id'],
    });
    expect(result.ok).toBe(false);
  });

  it('rejects deviceIds with mixed-case (regex enforces lowercase hex)', async () => {
    const result = await validateDto(ControlPlaneTokenRequestDto, {
      userId: TEAM9_USER_ID_V7,
      deviceIds: ['A'.repeat(64)],
    });
    expect(result.ok).toBe(false);
  });

  it('rejects more than 100 deviceIds', async () => {
    const result = await validateDto(ControlPlaneTokenRequestDto, {
      userId: TEAM9_USER_ID_V7,
      deviceIds: Array(101).fill(VALID_DEVICE_ID),
    });
    expect(result.ok).toBe(false);
  });
});
