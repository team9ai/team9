import { Transform } from 'class-transformer';
import { IsOptional, IsString, IsUUID } from 'class-validator';

export class InstallRecommendedStaffDto {
  @Transform(({ value }: { value: unknown }) => {
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  })
  @IsOptional()
  @IsString()
  @IsUUID()
  mentorId?: string | null;
}
