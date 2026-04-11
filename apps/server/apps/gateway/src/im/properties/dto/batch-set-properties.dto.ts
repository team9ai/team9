import { IsArray, IsString, IsNotEmpty, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

class PropertyEntry {
  @IsString()
  @IsNotEmpty()
  key: string;

  @IsNotEmpty({ message: 'value must not be empty' })
  value: unknown;
}

export class BatchSetPropertiesDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PropertyEntry)
  properties: PropertyEntry[];
}
