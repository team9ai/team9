import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';

export class CreateForwardDto {
  @IsUUID()
  sourceChannelId!: string;

  @IsArray()
  @ArrayMinSize(1, { message: 'forward.empty' })
  @ArrayMaxSize(100, { message: 'forward.tooManySelected' })
  @IsUUID('all', { each: true })
  sourceMessageIds!: string[];

  @IsOptional()
  @IsString()
  clientMsgId?: string;
}
