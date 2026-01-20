import { IsOptional, IsBoolean, IsDateString } from 'class-validator';

export class UpdatePreferencesDto {
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
  @IsDateString()
  dndStart?: string;

  @IsOptional()
  @IsDateString()
  dndEnd?: string;
}
