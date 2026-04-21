import { Type } from 'class-transformer';
import {
  IsArray,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  ValidateNested,
} from 'class-validator';

export class SendToUserAttachmentDto {
  @IsString() fileKey!: string;
  @IsString() fileName!: string;
  @IsString() mimeType!: string;
  @IsNumber() fileSize!: number;
}

export class SendToUserDto {
  @IsUUID() userId!: string;

  @IsString()
  @Length(1, 10_000)
  content!: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SendToUserAttachmentDto)
  attachments?: SendToUserAttachmentDto[];
}

export interface SendToUserResponse {
  channelId: string;
  messageId: string;
}
