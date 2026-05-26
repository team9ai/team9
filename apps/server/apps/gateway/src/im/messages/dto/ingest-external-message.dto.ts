import {
  IsArray,
  IsBoolean,
  IsDefined,
  IsIn,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

class ExternalMessageSenderDto {
  @IsString()
  externalUserId: string;

  @IsString()
  @IsOptional()
  displayName?: string;

  @IsString()
  @IsOptional()
  avatarUrl?: string;

  @IsBoolean()
  @IsOptional()
  isBot?: boolean;

  @IsObject()
  @IsOptional()
  raw?: Record<string, unknown>;
}

class ExternalMessageAttachmentDto {
  @IsString()
  @IsOptional()
  externalFileId?: string;

  @IsString()
  @MaxLength(500)
  fileName: string;

  @IsString()
  @IsOptional()
  mimeType?: string;

  @IsOptional()
  fileSize?: number;

  @IsString()
  @IsOptional()
  url?: string;

  @IsObject()
  @IsOptional()
  raw?: Record<string, unknown>;
}

class ExternalInboundMessageDto {
  @IsIn(['weixin-ilink'])
  provider: 'weixin-ilink';

  @IsString()
  idempotencyKey: string;

  @IsString()
  externalTenantId: string;

  @IsString()
  externalConversationId: string;

  @IsString()
  externalMessageId: string;

  @IsString()
  @IsOptional()
  externalThreadId?: string;

  @ValidateNested()
  @IsDefined()
  @IsObject()
  @Type(() => ExternalMessageSenderDto)
  sender: ExternalMessageSenderDto;

  @IsString()
  @MaxLength(100000)
  content: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ExternalMessageAttachmentDto)
  attachments: ExternalMessageAttachmentDto[];

  @IsISO8601()
  occurredAt: string;

  @IsObject()
  raw: Record<string, unknown>;
}

class ExternalConversationBindingDto {
  @IsString()
  connectionId: string;

  @IsUUID()
  team9UserId: string;

  @IsUUID()
  @IsOptional()
  team9TenantId?: string;

  @IsUUID()
  @IsOptional()
  team9ChannelId?: string;
}

export class IngestExternalMessageDto {
  @ValidateNested()
  @IsDefined()
  @IsObject()
  @Type(() => ExternalInboundMessageDto)
  message: ExternalInboundMessageDto;

  @ValidateNested()
  @IsDefined()
  @IsObject()
  @Type(() => ExternalConversationBindingDto)
  binding: ExternalConversationBindingDto;
}

export interface IngestExternalMessageResponse {
  team9MessageId: string;
  team9ChannelId: string;
  team9TenantId?: string;
  status: 'persisted' | 'duplicate';
}
