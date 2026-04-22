export class DeviceDto {
  id!: string;
  hubDeviceId!: string;
  nickname!: string;
  platform!: 'macos' | 'windows' | 'linux';
  hostname!: string | null;
  status!: 'active' | 'revoked';
  lastSeenAt!: string | null;
  isOnline!: boolean | null;
  createdAt!: string;
}

export class RegisterDeviceResponseDto {
  device!: DeviceDto;
  deviceJwt!: string;
  hubUrl!: string;
  jwtExpiresAt!: string;
}

export class TokenRefreshResponseDto {
  deviceJwt!: string;
  jwtExpiresAt!: string;
}
