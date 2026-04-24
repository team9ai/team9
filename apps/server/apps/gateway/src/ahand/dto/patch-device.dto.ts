import { IsOptional, IsString, Length } from 'class-validator';

export class PatchDeviceDto {
  @IsOptional()
  @IsString()
  @Length(1, 120)
  nickname?: string;
}
