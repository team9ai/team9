import {
  IsString,
  MaxLength,
  IsOptional,
  IsBoolean,
  IsObject,
  IsArray,
  IsUUID,
  IsIn,
} from 'class-validator';

export class UpdatePropertyDefinitionDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;

  @IsOptional()
  @IsBoolean()
  aiAutoFill?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  aiAutoFillPrompt?: string;

  @IsOptional()
  @IsBoolean()
  isRequired?: boolean;

  @IsOptional()
  defaultValue?: unknown;

  @IsOptional()
  @IsIn(['auto', 'show', 'hide'])
  showInChatPolicy?: string;

  @IsOptional()
  @IsBoolean()
  allowNewOptions?: boolean;
}

export class ReorderPropertyDefinitionsDto {
  @IsArray()
  @IsUUID('all', { each: true })
  definitionIds: string[];
}
