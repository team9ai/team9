import {
  IsIn,
  IsISO8601,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';

export class WebhookEventDataDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  sentAtMs?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  presenceTtlSeconds?: number;

  @IsOptional()
  @IsString()
  nickname?: string;

  // Additional per-eventType fields are allowed.
  [key: string]: unknown;
}

export class WebhookEventDto {
  @IsString()
  @MaxLength(128)
  @Matches(/^evt_[A-Z0-9_]+$/i)
  eventId!: string;

  @IsIn([
    'device.registered',
    'device.online',
    'device.heartbeat',
    'device.offline',
    'device.revoked',
  ])
  eventType!:
    | 'device.registered'
    | 'device.online'
    | 'device.heartbeat'
    | 'device.offline'
    | 'device.revoked';

  @IsISO8601()
  occurredAt!: string;

  @IsString()
  @Matches(/^[0-9a-f]{64}$/)
  deviceId!: string;

  @IsString()
  @IsNotEmpty()
  externalUserId!: string;

  @IsObject()
  data!: WebhookEventDataDto;
}
