import {
  IsOptional,
  IsBoolean,
  IsDateString,
  ValidateIf,
} from 'class-validator';

export class UpdateNotificationPreferencesDto {
  @IsOptional()
  @IsBoolean()
  mentionsEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  repliesEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  dmsEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  systemEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  workspaceEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  desktopEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  soundEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  dndEnabled?: boolean;

  @IsOptional()
  @ValidateIf((_obj, value) => value !== null)
  @IsDateString()
  dndStart?: string | null;

  @IsOptional()
  @ValidateIf((_obj, value) => value !== null)
  @IsDateString()
  dndEnd?: string | null;
}
