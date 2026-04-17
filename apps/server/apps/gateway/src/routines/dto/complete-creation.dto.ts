import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class CompleteCreationDto {
  @IsString()
  @IsOptional()
  @MaxLength(2000)
  notes?: string;

  /**
   * If true, dispatch one manual execution immediately after finalization.
   * Driven by the agent's `finishRoutineCreation` tool when the user
   * confirmed they want the routine to run once right away.
   */
  @IsBoolean()
  @IsOptional()
  autoRunFirst?: boolean;
}
