import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard, CurrentUser } from '@team9/auth';
import type { User } from '@team9/database/schemas';
import {
  AhandDevicesService,
  type DeviceWithPresence,
} from './ahand.service.js';
import { RegisterDeviceDto } from './dto/register-device.dto.js';
import {
  type DeviceDto,
  type RegisterDeviceResponseDto,
  type TokenRefreshResponseDto,
} from './dto/device.dto.js';
import { PatchDeviceDto } from './dto/patch-device.dto.js';

@UseGuards(AuthGuard)
@Controller({ path: 'ahand/devices', version: '1' })
export class AhandController {
  constructor(private readonly svc: AhandDevicesService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async register(
    @CurrentUser() user: User,
    @Body() body: RegisterDeviceDto,
  ): Promise<RegisterDeviceResponseDto> {
    const res = await this.svc.registerDeviceForUser(user.id, body);
    return {
      device: toDeviceDto({ ...res.device, isOnline: false }),
      deviceJwt: res.deviceJwt,
      hubUrl: res.hubUrl,
      jwtExpiresAt: res.jwtExpiresAt,
    };
  }

  @Get()
  async list(
    @CurrentUser() user: User,
    @Query('includeOffline') includeOfflineRaw?: string,
  ): Promise<DeviceDto[]> {
    const includeOffline = includeOfflineRaw !== 'false';
    const rows = await this.svc.listActiveDevicesForUser(user.id, {
      includeOffline,
    });
    return rows.map(toDeviceDto);
  }

  @Post(':id/token/refresh')
  async refreshToken(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<TokenRefreshResponseDto> {
    const { token, expiresAt } = await this.svc.refreshDeviceToken(user.id, id);
    return { deviceJwt: token, jwtExpiresAt: expiresAt };
  }

  @Patch(':id')
  async patch(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: PatchDeviceDto,
  ): Promise<DeviceDto> {
    const row = await this.svc.patchDevice(user.id, id, body);
    return toDeviceDto({ ...row, isOnline: null });
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.svc.revokeDevice(user.id, id);
  }
}

function toDeviceDto(row: DeviceWithPresence): DeviceDto {
  return {
    id: row.id,
    hubDeviceId: row.hubDeviceId,
    nickname: row.nickname,
    platform: row.platform as DeviceDto['platform'],
    hostname: row.hostname,
    status: row.status as DeviceDto['status'],
    lastSeenAt: row.lastSeenAt?.toISOString() ?? null,
    isOnline: row.isOnline,
    createdAt: row.createdAt.toISOString(),
  };
}
