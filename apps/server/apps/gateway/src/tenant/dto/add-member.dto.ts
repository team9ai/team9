import { IsString, IsOptional, IsEnum, IsUUID } from 'class-validator';

export class AddMemberDto {
  @IsUUID()
  userId: string;

  @IsOptional()
  @IsEnum(['owner', 'admin', 'member', 'guest'])
  role?: 'owner' | 'admin' | 'member' | 'guest';
}

export class UpdateMemberRoleDto {
  @IsEnum(['owner', 'admin', 'member', 'guest'])
  role: 'owner' | 'admin' | 'member' | 'guest';
}
