import {
  IsString,
  IsNotEmpty,
  IsDefined,
  ValidateNested,
  IsUrl,
} from 'class-validator';
import { Type } from 'class-transformer';

export class PushSubscriptionKeysDto {
  @IsString()
  @IsNotEmpty()
  p256dh: string;

  @IsString()
  @IsNotEmpty()
  auth: string;
}

export class SubscribePushDto {
  @IsUrl({ protocols: ['https'] })
  @IsNotEmpty()
  endpoint: string;

  @IsDefined()
  @ValidateNested()
  @Type(() => PushSubscriptionKeysDto)
  keys: PushSubscriptionKeysDto;
}

export class UnsubscribePushDto {
  @IsUrl({ protocols: ['https'] })
  @IsNotEmpty()
  endpoint: string;
}
