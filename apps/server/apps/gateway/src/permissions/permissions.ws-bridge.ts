// apps/server/apps/gateway/src/permissions/permissions.ws-bridge.ts
import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { WebsocketGateway } from '../im/websocket/websocket.gateway.js';
import { PermissionsService } from './permissions.service.js';
import { BotService } from '../bot/bot.service.js';
import { type PermissionKey } from './permission-keys.js';
import {
  PERMISSION_EVENTS,
  type PermissionRequestCreatedPayload,
  type PermissionRequestDecidedPayload,
  type PermissionRequestConsumedPayload,
  type PermissionGrantCreatedPayload,
  type PermissionGrantRevokedPayload,
} from '@team9/shared';

/**
 * PermissionsWsBridge
 *
 * Listens to internal EventEmitter2 events emitted by PermissionsService and
 * dispatches them as WebSocket notifications to the relevant users via
 * WebsocketGateway.sendToUser.
 *
 * - request.created  → approvers (pre-resolved, passed in payload)
 * - request.decided  → approvers (re-resolved) + requester bot's user account
 * - request.consumed → approvers (re-resolved from the request row)
 * - grant.created    → all workspace admins of the tenant
 * - grant.revoked    → all workspace admins of the tenant
 */
@Injectable()
export class PermissionsWsBridge {
  private readonly logger = new Logger(PermissionsWsBridge.name);

  constructor(
    private readonly gateway: WebsocketGateway,
    private readonly permissions: PermissionsService,
    private readonly bots: BotService,
  ) {}

  /**
   * Handles `permissions.request.created`.
   *
   * The approverIds are pre-computed by PermissionsService.createRequest and
   * embedded in the event payload — we do NOT call resolveApprovers again to
   * avoid redundant DB queries.
   */
  @OnEvent('permissions.request.created')
  async onRequestCreated(
    payload: PermissionRequestCreatedPayload & { approverIds: string[] },
  ): Promise<void> {
    await Promise.all(
      payload.approverIds.map((userId) =>
        this.gateway.sendToUser(
          userId,
          PERMISSION_EVENTS.REQUEST_CREATED,
          payload,
        ),
      ),
    );
  }

  /**
   * Handles `permissions.request.decided`.
   *
   * Re-resolves approvers from the request row so the correct approver set is
   * notified even if the list changed between creation and decision.
   * Also notifies the bot's shadow user account so the agent can react.
   */
  @OnEvent('permissions.request.decided')
  async onRequestDecided(
    payload: PermissionRequestDecidedPayload,
  ): Promise<void> {
    const req = await this.permissions.getRequest(payload.id);
    if (!req) {
      this.logger.warn(
        `onRequestDecided: request ${payload.id} not found, skipping broadcast`,
      );
      return;
    }

    const recipients = new Set(
      await this.permissions.resolveApprovers({
        ...req,
        permissionKey: req.permissionKey as PermissionKey,
      }),
    );
    const botUserId = await this.bots.getBotUserIdByBotId(req.requesterBotId);
    if (botUserId) {
      recipients.add(botUserId);
    }

    await Promise.all(
      [...recipients].map((userId) =>
        this.gateway.sendToUser(
          userId,
          PERMISSION_EVENTS.REQUEST_DECIDED,
          payload,
        ),
      ),
    );
  }

  /**
   * Handles `permissions.request.consumed`.
   *
   * Loads the request row to re-resolve approvers so they can update any
   * pending-approval UI showing the once-approved request.
   */
  @OnEvent('permissions.request.consumed')
  async onRequestConsumed(
    payload: PermissionRequestConsumedPayload,
  ): Promise<void> {
    const req = await this.permissions.getRequest(payload.id);
    if (!req) {
      this.logger.warn(
        `onRequestConsumed: request ${payload.id} not found, skipping broadcast`,
      );
      return;
    }

    const recipients = await this.permissions.resolveApprovers({
      ...req,
      permissionKey: req.permissionKey as PermissionKey,
    });
    await Promise.all(
      recipients.map((userId) =>
        this.gateway.sendToUser(
          userId,
          PERMISSION_EVENTS.REQUEST_CONSUMED,
          payload,
        ),
      ),
    );
  }

  /**
   * Handles `permissions.grant.created`.
   * Notifies all workspace admins so they can audit the new grant.
   */
  @OnEvent('permissions.grant.created')
  async onGrantCreated(payload: PermissionGrantCreatedPayload): Promise<void> {
    const userIds = await this.permissions.listAdminsForTenant(
      payload.tenantId,
    );
    await Promise.all(
      userIds.map((userId) =>
        this.gateway.sendToUser(
          userId,
          PERMISSION_EVENTS.GRANT_CREATED,
          payload,
        ),
      ),
    );
  }

  /**
   * Handles `permissions.grant.revoked`.
   * Notifies all workspace admins so they can audit the revocation.
   */
  @OnEvent('permissions.grant.revoked')
  async onGrantRevoked(payload: PermissionGrantRevokedPayload): Promise<void> {
    const userIds = await this.permissions.listAdminsForTenant(
      payload.tenantId,
    );
    await Promise.all(
      userIds.map((userId) =>
        this.gateway.sendToUser(
          userId,
          PERMISSION_EVENTS.GRANT_REVOKED,
          payload,
        ),
      ),
    );
  }
}
