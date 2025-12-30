import { IsEnum, IsInt, IsOptional, Min } from 'class-validator';

export class CreateInvitationDto {
  @IsOptional()
  @IsEnum(['owner', 'admin', 'member', 'guest'])
  role?: 'owner' | 'admin' | 'member' | 'guest';

  @IsOptional()
  @IsInt()
  @Min(1)
  maxUses?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  expiresInDays?: number;
}
