import { IsDefined } from 'class-validator';

export class SetPropertyValueDto {
  @IsDefined({ message: 'value must be defined' })
  value: unknown;
}
