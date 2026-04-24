import { Type } from 'class-transformer';
import {
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';

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
   * First user message. Required — an empty topic session provides no
   * useful UX and would leak an orphan channel if the user abandoned
   * the form. The title-generation pipeline also keys off this content.
   */
  @IsString()
  @IsNotEmpty()
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
}
