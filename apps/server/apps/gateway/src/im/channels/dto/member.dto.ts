import { IsUUID, IsEnum, IsOptional, IsBoolean } from 'class-validator';

export class AddMemberDto {
  @IsUUID()
  userId: string;

  @IsEnum(['admin', 'member'])
  @IsOptional()
  role?: 'admin' | 'member';
}

export class UpdateMemberDto {
  @IsEnum(['admin', 'member'])
  @IsOptional()
  role?: 'admin' | 'member';

  @IsBoolean()
  @IsOptional()
  isMuted?: boolean;

  @IsBoolean()
  @IsOptional()
  notificationsEnabled?: boolean;
}
