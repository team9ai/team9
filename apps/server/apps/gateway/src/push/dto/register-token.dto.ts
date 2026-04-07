import { IsString, IsNotEmpty, IsIn, MaxLength } from 'class-validator';

export class RegisterTokenDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  token: string;

  @IsIn(['ios', 'android'])
  platform: 'ios' | 'android';
}

export class UnregisterTokenDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  token: string;
}
