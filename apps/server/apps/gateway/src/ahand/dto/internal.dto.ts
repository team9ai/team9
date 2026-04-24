import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
} from 'class-validator';

export class ControlPlaneTokenRequestDto {
  @IsUUID('4')
  userId!: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @Matches(/^[0-9a-f]{64}$/, { each: true })
  deviceIds?: string[];
}

export class ControlPlaneTokenResponseDto {
  token!: string;
  expiresAt!: string;
}

export class ListDevicesForUserRequestDto {
  @IsUUID('4')
  userId!: string;

  @IsOptional()
  @IsBoolean()
  includeOffline?: boolean;
}

export class InternalDeviceDto {
  id!: string;
  hubDeviceId!: string;
  publicKey!: string;
  nickname!: string;
  platform!: 'macos' | 'windows' | 'linux';
  hostname!: string | null;
  status!: 'active' | 'revoked';
  isOnline!: boolean | null;
  lastSeenAt!: string | null;
  createdAt!: string;
}
