import { IsNotEmpty } from 'class-validator';

export class SetPropertyValueDto {
  @IsNotEmpty({ message: 'value must not be empty' })
  value: unknown;
}
