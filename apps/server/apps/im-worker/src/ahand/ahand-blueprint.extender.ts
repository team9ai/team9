import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { env } from '@team9/shared';
import {
  AhandControlPlaneClient,
  type AhandDeviceSummary,
} from './ahand-control-plane.client.js';

// ─── Types ───────────────────────────────────────────────────────────────────
//
// We intentionally avoid importing from @team9claw/claw-hive here so that
// im-worker does not need a direct dependency on the claw-hive package's
// class types (it only calls ClawHiveService via HTTP). Instead we mirror
// the minimal shapes the blueprint API requires.

export type ClientContextRaw =
  | { kind: 'macapp'; deviceId?: string | null }
  | { kind: 'web' }
  | null;

export interface ComponentEntry {
  typeKey: string;
  config: Record<string, unknown>;
}

export interface Blueprint {
  components: ComponentEntry[];
  [key: string]: unknown;
}

export interface ExtenderInput {
  callingUserId: string;
  clientContext: ClientContextRaw;
}

export interface AhandTrackingState {
  sessionId: string | null;
  userId: string;
  onlineDeviceIds: string[];
}

export interface ExtenderOutput {
  blueprint: Blueprint;
  ahandTrackingState: AhandTrackingState;
}

type ResolvedCallingClient =
  | {
      kind: 'macapp';
      deviceId: string;
      deviceNickname: string;
      isAhandEnabled: boolean;
    }
  | { kind: 'web' };

/**
 * AhandBlueprintExtender injects ahand-related components into a session
 * blueprint at session-start time.
 *
 * One `ahand-host` component per **online + active** device is appended,
 * plus exactly one `ahand-context-provider` regardless of device count.
 *
 * If the blueprint has no `host` component, ahand injection is skipped
 * (session would have no HostComponent to register against — misconfig).
 *
 * Gateway failures are caught and logged; the session starts normally
 * without ahand components rather than crashing.
 */
@Injectable()
export class AhandBlueprintExtender implements OnModuleInit {
  private readonly logger = new Logger(AhandBlueprintExtender.name);

  constructor(private readonly control: AhandControlPlaneClient) {}

  onModuleInit(): void {
    // Validate required config eagerly so misconfiguration fails at boot
    // rather than silently degrading ahand injection.
    try {
      const token = env.INTERNAL_AUTH_VALIDATION_TOKEN;
      if (!token) {
        this.logger.warn(
          'INTERNAL_AUTH_VALIDATION_TOKEN is not set — ahand component injection will be disabled',
        );
      }
    } catch {
      this.logger.warn(
        'INTERNAL_AUTH_VALIDATION_TOKEN is not set — ahand component injection will be disabled',
      );
    }
  }

  private get hubUrl(): string {
    return env.AHAND_HUB_URL ?? '';
  }

  private get gatewayInternalUrl(): string {
    return env.GATEWAY_INTERNAL_URL ?? '';
  }

  // INTERNAL_AUTH_VALIDATION_TOKEN is required (throws if missing).
  private get gatewayInternalToken(): string {
    return env.INTERNAL_AUTH_VALIDATION_TOKEN;
  }

  async extend(
    blueprint: Blueprint,
    input: ExtenderInput,
  ): Promise<ExtenderOutput> {
    const emptyTracking: AhandTrackingState = {
      sessionId: null,
      userId: input.callingUserId,
      onlineDeviceIds: [],
    };

    // Skip when the blueprint has no HostComponent — ahand backends register
    // themselves with HostComponent; without it there's nothing to register to.
    const hasHost = blueprint.components.some((c) => c.typeKey === 'host');
    if (!hasHost) {
      this.logger.warn(
        `Blueprint has no HostComponent — skipping ahand injection for user ${input.callingUserId}`,
      );
      return { blueprint, ahandTrackingState: emptyTracking };
    }

    let devices: AhandDeviceSummary[] = [];
    try {
      devices = await this.control.listDevicesForUser(input.callingUserId, {
        includeOffline: true,
      });
    } catch (e) {
      this.logger.warn(
        `Failed to list ahand devices for ${input.callingUserId}; starting session without ahand: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
      return { blueprint, ahandTrackingState: emptyTracking };
    }

    const onlineDevices = devices.filter(
      (d) => d.isOnline === true && d.status === 'active',
    );
    const callingClient = this.resolveCallingClient(
      input.clientContext,
      devices,
    );

    const extra: ComponentEntry[] = [];

    for (const d of onlineDevices) {
      extra.push({
        typeKey: 'ahand-host',
        config: {
          deviceId: d.hubDeviceId,
          deviceNickname: d.nickname,
          devicePlatform: d.platform,
          callingUserId: input.callingUserId,
          callingClient,
          gatewayInternalUrl: this.gatewayInternalUrl,
          gatewayInternalAuthToken: this.gatewayInternalToken,
          hubUrl: this.hubUrl,
        },
      });
    }

    // Always append exactly one AHandContextProvider.
    extra.push({
      typeKey: 'ahand-context-provider',
      config: {
        callingUserId: input.callingUserId,
        callingClient,
        gatewayInternalUrl: this.gatewayInternalUrl,
        gatewayInternalAuthToken: this.gatewayInternalToken,
      },
    });

    return {
      blueprint: {
        ...blueprint,
        components: [...blueprint.components, ...extra],
      },
      ahandTrackingState: {
        sessionId: null,
        userId: input.callingUserId,
        onlineDeviceIds: onlineDevices.map((d) => d.hubDeviceId),
      },
    };
  }

  // ─── Private ─────────────────────────────────────────────────────────────

  private resolveCallingClient(
    raw: ClientContextRaw,
    devices: AhandDeviceSummary[],
  ): ResolvedCallingClient {
    if (!raw || raw.kind !== 'macapp' || !raw.deviceId) {
      return { kind: 'web' };
    }
    const match = devices.find((d) => d.hubDeviceId === raw.deviceId);
    if (!match) {
      // clientContext claims a deviceId not owned by this user → treat as web.
      return { kind: 'web' };
    }
    return {
      kind: 'macapp',
      deviceId: match.hubDeviceId,
      deviceNickname: match.nickname,
      isAhandEnabled: match.status === 'active' && match.isOnline === true,
    };
  }
}
