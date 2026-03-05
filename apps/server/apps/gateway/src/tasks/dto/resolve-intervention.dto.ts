import { IsString, IsOptional } from 'class-validator';

export class ResolveInterventionDto {
  @IsString()
  action: string;

  @IsString()
  @IsOptional()
  message?: string;
}
