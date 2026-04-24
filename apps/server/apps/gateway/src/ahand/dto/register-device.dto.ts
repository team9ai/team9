import { IsIn, IsOptional, IsString, Length, Matches } from 'class-validator';

export class RegisterDeviceDto {
  @IsString()
  @Matches(/^[0-9a-f]{64}$/, {
    message: 'hubDeviceId must be 64 lowercase hex chars (SHA256)',
  })
  hubDeviceId!: string;

  @IsString()
  @Length(1, 1024)
  publicKey!: string;

  @IsString()
  @Length(1, 120)
  nickname!: string;

  @IsIn(['macos', 'windows', 'linux'])
  platform!: 'macos' | 'windows' | 'linux';

  @IsOptional()
  @IsString()
  @Length(0, 255)
  hostname?: string;
}
