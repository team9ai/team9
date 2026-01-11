import { IsString, IsOptional, IsBoolean } from 'class-validator';

export class DeleteChannelDto {
  @IsString()
  @IsOptional()
  confirmationName?: string;

  @IsBoolean()
  @IsOptional()
  permanent?: boolean;
}
