import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { InternalAuthGuard } from '../auth/internal-auth.guard.js';
import { AhandDevicesService } from './ahand.service.js';
import {
  ControlPlaneTokenRequestDto,
  ControlPlaneTokenResponseDto,
  InternalDeviceDto,
  ListDevicesForUserRequestDto,
} from './dto/internal.dto.js';

/**
 * Internal ahand endpoints consumed exclusively by im-worker.
 *
 * Authentication: InternalAuthGuard (Bearer INTERNAL_AUTH_VALIDATION_TOKEN,
 * constant-time compared). The userId in the request body is the source of
 * truth; this controller does not inspect any user-facing JWT.
 */
@UseGuards(InternalAuthGuard)
@Controller({ path: 'internal/ahand', version: '1' })
export class AhandInternalController {
  constructor(private readonly svc: AhandDevicesService) {}

  @Post('control-plane/token')
  @HttpCode(HttpStatus.OK)
  async mintControlPlaneToken(
    @Body() body: ControlPlaneTokenRequestDto,
  ): Promise<ControlPlaneTokenResponseDto> {
    const { token, expiresAt } = await this.svc.mintControlPlaneTokenForUser(
      body.userId,
      body.deviceIds,
    );
    return { token, expiresAt };
  }

  @Post('devices/list-for-user')
  @HttpCode(HttpStatus.OK)
  async listDevicesForUser(
    @Body() body: ListDevicesForUserRequestDto,
  ): Promise<InternalDeviceDto[]> {
    const rows = await this.svc.listActiveDevicesForUser(body.userId, {
      includeOffline: body.includeOffline ?? true,
    });
    return rows.map((r) => ({
      id: r.id,
      hubDeviceId: r.hubDeviceId,
      publicKey: r.publicKey,
      nickname: r.nickname,
      platform: r.platform as InternalDeviceDto['platform'],
      hostname: r.hostname,
      status: r.status as InternalDeviceDto['status'],
      isOnline: r.isOnline,
      lastSeenAt: r.lastSeenAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
    }));
  }
}
