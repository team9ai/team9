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
@Controller('ahand/devices')
export class AhandController {
  constructor(private readonly svc: AhandDevicesService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async register(
    @CurrentUser('sub') userId: string,
    @Body() body: RegisterDeviceDto,
  ): Promise<RegisterDeviceResponseDto> {
    const res = await this.svc.registerDeviceForUser(userId, body);
    return {
      device: toDeviceDto({ ...res.device, isOnline: false }),
      deviceJwt: res.deviceJwt,
      hubUrl: res.hubUrl,
      jwtExpiresAt: res.jwtExpiresAt,
    };
  }

  @Get()
  async list(
    @CurrentUser('sub') userId: string,
    @Query('includeOffline') includeOfflineRaw?: string,
  ): Promise<DeviceDto[]> {
    const includeOffline = includeOfflineRaw !== 'false';
    const rows = await this.svc.listActiveDevicesForUser(userId, {
      includeOffline,
    });
    return rows.map(toDeviceDto);
  }

  @Post(':id/token/refresh')
  async refreshToken(
    @CurrentUser('sub') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<TokenRefreshResponseDto> {
    const { token, expiresAt } = await this.svc.refreshDeviceToken(userId, id);
    return { deviceJwt: token, jwtExpiresAt: expiresAt };
  }

  @Patch(':id')
  async patch(
    @CurrentUser('sub') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: PatchDeviceDto,
  ): Promise<DeviceDto> {
    const row = await this.svc.patchDevice(userId, id, body);
    return toDeviceDto({ ...row, isOnline: null });
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(
    @CurrentUser('sub') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.svc.revokeDevice(userId, id);
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
