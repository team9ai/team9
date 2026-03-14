import { IsString, IsNotEmpty } from 'class-validator';

export class CompleteDesktopSessionDto {
  @IsString()
  @IsNotEmpty()
  sessionId: string;

  @IsString()
  @IsNotEmpty()
  pairCode: string;
}
