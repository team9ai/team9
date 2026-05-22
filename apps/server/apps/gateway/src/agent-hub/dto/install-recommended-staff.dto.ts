import { IsOptional, IsString } from 'class-validator';

export class InstallRecommendedStaffDto {
  @IsOptional()
  @IsString()
  mentorId?: string | null;
}
