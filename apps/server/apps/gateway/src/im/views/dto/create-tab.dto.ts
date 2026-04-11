import { IsString, MaxLength, IsOptional, IsUUID, IsIn } from 'class-validator';

const TAB_TYPES = ['messages', 'files', 'view'] as const;

export class CreateTabDto {
  @IsString()
  @MaxLength(100)
  name: string;

  @IsIn(TAB_TYPES, {
    message: `type must be one of: ${TAB_TYPES.join(', ')}`,
  })
  type: string;

  @IsOptional()
  @IsUUID()
  viewId?: string;
}
