import { IsString, IsNotEmpty, IsOptional, IsIn } from 'class-validator';

export class GoogleLoginDto {
  @IsString()
  @IsNotEmpty()
  credential: string;

  @IsOptional()
  @IsString()
  @IsIn(['self', 'invite'])
  signupSource?: 'self' | 'invite';
}
