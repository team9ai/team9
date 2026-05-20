import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class DeepResearchSessionActionDto {
  @IsIn(['modify_plan', 'start_research', 'follow_up'])
  action!: 'modify_plan' | 'start_research' | 'follow_up';

  @IsUUID()
  planMessageId!: string;

  @IsString()
  @MaxLength(200)
  planInteractionId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(20000)
  input?: string;
}
