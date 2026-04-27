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
  Validate,
  ValidationArguments,
  ValidatorConstraint,
  type ValidatorConstraintInterface,
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

/**
 * Enforces that `device.heartbeat` events carry both `sentAtMs` and
 * `presenceTtlSeconds` in `data`. The hub always emits both
 * (`crates/ahand-hub/src/webhook/mod.rs::enqueue_heartbeat`) and the
 * canonical schema (`contracts/hub-webhook.json::HeartbeatData`)
 * marks them required. Without this validator, the gateway DTO would
 * silently accept a hub regression that drops one of those fields —
 * exactly the drift Phase 9 / Task 9.5's contract test exists to
 * catch. We attach this at the parent DTO level (not on
 * `WebhookEventDataDto`) so the validator can read the sibling
 * `eventType` and only fire on heartbeat payloads.
 */
@ValidatorConstraint({ name: 'heartbeatDataRequired', async: false })
class HeartbeatDataRequiredConstraint implements ValidatorConstraintInterface {
  validate(data: unknown, args: ValidationArguments): boolean {
    const parent = args.object as { eventType?: string };
    if (parent.eventType !== 'device.heartbeat') return true;
    if (!data || typeof data !== 'object') return false;
    const d = data as { sentAtMs?: unknown; presenceTtlSeconds?: unknown };
    return (
      typeof d.sentAtMs === 'number' && typeof d.presenceTtlSeconds === 'number'
    );
  }

  defaultMessage(): string {
    return 'device.heartbeat events require data.sentAtMs (number) and data.presenceTtlSeconds (number)';
  }
}

export class WebhookEventDto {
  // Hub emits bare ULIDs (26 Crockford-base32 chars, e.g.
  // `01KPZXF939E45M8ZQN9GWFM0DY`). Older designs used a `evt_` prefix;
  // accept both so the gateway isn't coupled to the hub's id scheme.
  @IsString()
  @MaxLength(128)
  @Matches(/^(evt_)?[A-Z0-9_]+$/i)
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

  // Hub omits this field on events where it's not known / applicable
  // (ahand-hub/src/webhook/mod.rs uses serde skip_serializing_if on
  // Option::is_none). Gateway handlers look the owner up server-side
  // by deviceId for non-registered events anyway.
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  externalUserId?: string;

  @IsObject()
  @Validate(HeartbeatDataRequiredConstraint)
  data!: WebhookEventDataDto;
}
