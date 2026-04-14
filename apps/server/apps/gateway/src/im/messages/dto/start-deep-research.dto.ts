import {
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class StartDeepResearchDto {
  @IsString()
  @MaxLength(100000)
  input: string;

  @IsOptional()
  @IsIn(['dashboard', 'chat'])
  origin?: 'dashboard' | 'chat';

  @IsOptional()
  @IsObject()
  agentConfig?: {
    thinkingSummaries?: 'auto' | 'off';
  };
}
