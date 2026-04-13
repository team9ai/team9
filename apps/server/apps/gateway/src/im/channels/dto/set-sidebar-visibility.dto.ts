import { IsBoolean } from 'class-validator';

export class SetSidebarVisibilityDto {
  @IsBoolean()
  show: boolean;
}
