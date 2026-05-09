import { Type } from 'class-transformer';
import {
  IsArray,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { AttachmentDto } from '../../messages/dto/create-message.dto.js';

class AgentModelDto {
  @IsString()
  @IsNotEmpty()
  provider!: string;

  @IsString()
  @IsNotEmpty()
  id!: string;
}

export class CreateTopicSessionDto {
  /** Bot shadow user id (team9 users.id) the topic is with. */
  @IsUUID()
  botUserId!: string;

  /**
   * First user message. Either `initialMessage` or at least one
   * `attachments` entry must be present — an entirely empty topic
   * session provides no useful UX and would leak an orphan channel
   * if the user abandoned the form. The "non-empty OR has attachment"
   * cross-field check is enforced in the controller because
   * class-validator's `ValidateIf` would skip ALL validators on the
   * property (including IsString/MaxLength), which would open a type
   * bypass when attachments are present.
   *
   * The title-generation pipeline keys off this content (or falls
   * back to the attachment's filename when content is empty).
   */
  @IsString()
  @MaxLength(20000)
  initialMessage!: string;

  /** Optional session-initial model override. */
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => AgentModelDto)
  model?: AgentModelDto;

  /**
   * Optional pre-set title. Usually omitted — title is filled in later
   * by the auto-generation pipeline after the first agent reply.
   */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  /**
   * Optional attachments to send alongside the initial message. Same
   * shape as CreateMessageDto.attachments — clients upload via
   * presign → S3 → confirm and pass the resulting fileKey here.
   */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AttachmentDto)
  attachments?: AttachmentDto[];
}
