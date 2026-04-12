import {
  IsString,
  MaxLength,
  IsEnum,
  IsOptional,
  IsBoolean,
  IsObject,
  IsIn,
  Matches,
} from 'class-validator';
import type { PropertyValueType } from '@team9/shared';

const PROPERTY_VALUE_TYPES: PropertyValueType[] = [
  'text',
  'number',
  'boolean',
  'single_select',
  'multi_select',
  'person',
  'date',
  'timestamp',
  'date_range',
  'timestamp_range',
  'recurring',
  'url',
  'message_ref',
  'file',
  'image',
  'tags',
];

export class CreatePropertyDefinitionDto {
  @IsString()
  @MaxLength(100)
  @Matches(/^[a-zA-Z][a-zA-Z0-9_]*$/, {
    message:
      'Key must start with a letter and contain only letters, numbers, and underscores',
  })
  key: string;

  @IsEnum(PROPERTY_VALUE_TYPES, {
    message: `valueType must be one of: ${PROPERTY_VALUE_TYPES.join(', ')}`,
  })
  valueType: PropertyValueType;

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
