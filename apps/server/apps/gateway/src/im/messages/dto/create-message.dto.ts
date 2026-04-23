import {
  IsString,
  IsOptional,
  IsUUID,
  IsArray,
  IsObject,
  IsBoolean,
  IsIn,
  ValidateNested,
  MaxLength,
  IsNumber,
} from 'class-validator';
import { Type } from 'class-transformer';

export class AttachmentDto {
  @IsString()
  fileKey: string;

  @IsString()
  @MaxLength(500)
  fileName: string;

  @IsString()
  mimeType: string;

  @IsNumber() // in bytes
  fileSize: number;
}

/**
 * Identifies which client originated a message, so downstream agent runtimes
 * can reason about the user's current device context (e.g. when an agent has
 * access to ahand backends, it can prefer the MacApp the user is currently on).
 *
 * Persisted into `messages.metadata.clientContext`; not indexed or queried.
 */
export class ClientContextDto {
  @IsIn(['macapp', 'web'])
  kind: 'macapp' | 'web';

  @IsString()
  @IsOptional()
  deviceId?: string | null;
}

export class CreateMessageDto {
  @IsString()
  @IsOptional()
  @MaxLength(64)
  clientMsgId?: string;

  @IsString()
  @MaxLength(100000)
  content: string;

  @IsUUID()
  @IsOptional()
  parentId?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AttachmentDto)
  @IsOptional()
  attachments?: AttachmentDto[];

  @IsObject()
  @IsOptional()
  metadata?: Record<string, unknown>;

  /**
   * Originating-client attribution. When provided, the controller merges it
   * into `metadata.clientContext` before persistence. Accepting it as a
   * top-level field matches the Stream E client's send_message wire shape.
   */
  @ValidateNested()
  @Type(() => ClientContextDto)
  @IsOptional()
  clientContext?: ClientContextDto;

  @IsBoolean()
  @IsOptional()
  skipBroadcast?: boolean;

  @IsObject()
  @IsOptional()
  properties?: Record<string, unknown>;
}
