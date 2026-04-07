import { IsOptional, IsString } from 'class-validator';

export class GeneratePersonaDto {
  @IsOptional()
  @IsString()
  displayName?: string;

  @IsOptional()
  @IsString()
  roleTitle?: string;

  @IsOptional()
  @IsString()
  existingPersona?: string;

  @IsOptional()
  @IsString()
  prompt?: string;

  @IsOptional()
  @IsString()
  jobDescription?: string;
}

export class GenerateAvatarDto {
  @IsString()
  style: 'realistic' | 'cartoon' | 'anime' | 'notion-lineart';

  @IsOptional()
  @IsString()
  displayName?: string;

  @IsOptional()
  @IsString()
  roleTitle?: string;

  @IsOptional()
  @IsString()
  persona?: string;

  @IsOptional()
  @IsString()
  prompt?: string;
}

export class GenerateCandidatesDto {
  @IsOptional()
  @IsString()
  jobTitle?: string;

  @IsOptional()
  @IsString()
  jobDescription?: string;
}
