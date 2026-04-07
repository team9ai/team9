import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class OnboardingRoleContextDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string | null;

  @IsOptional()
  @IsString()
  selectedRoleId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  selectedRoleSlug?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  selectedRoleLabel?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  selectedRoleCategoryKey?: string | null;
}

export class OnboardingRoleSelectionDto extends OnboardingRoleContextDto {
  @IsOptional()
  @IsString()
  @MaxLength(32)
  selectedTag?: string;
}

export class OnboardingTaskDraftDto {
  @IsString()
  @IsNotEmpty()
  id!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(16)
  emoji!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  title!: string;
}

export class OnboardingTasksContextDto {
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OnboardingTaskDraftDto)
  generatedTasks?: OnboardingTaskDraftDto[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  selectedTaskIds?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  customTask?: string | null;
}

export class OnboardingChannelDraftDto {
  @IsString()
  @IsNotEmpty()
  id!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name!: string;
}

export class OnboardingChannelsSelectionDto {
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OnboardingChannelDraftDto)
  channelDrafts?: OnboardingChannelDraftDto[];

  @IsOptional()
  @IsString()
  activeChannelId?: string | null;
}

export class OnboardingMainAgentDraftDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(16)
  emoji!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  description!: string;
}

export class OnboardingChildAgentDraftDto {
  @IsString()
  @IsNotEmpty()
  id!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(16)
  emoji!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name!: string;
}

export class OnboardingAgentsSelectionDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => OnboardingMainAgentDraftDto)
  main?: OnboardingMainAgentDraftDto;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OnboardingChildAgentDraftDto)
  children?: OnboardingChildAgentDraftDto[];
}

export class OnboardingInviteSelectionDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  invitationCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  invitationUrl?: string;
}

export class OnboardingPlanSelectionDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  selectedPlan?: string | null;

  @IsOptional()
  @IsBoolean()
  checkoutCompleted?: boolean;
}

export class WorkspaceOnboardingStepDataDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => OnboardingRoleSelectionDto)
  role?: OnboardingRoleSelectionDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => OnboardingTasksContextDto)
  tasks?: OnboardingTasksContextDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => OnboardingChannelsSelectionDto)
  channels?: OnboardingChannelsSelectionDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => OnboardingAgentsSelectionDto)
  agents?: OnboardingAgentsSelectionDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => OnboardingInviteSelectionDto)
  invite?: OnboardingInviteSelectionDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => OnboardingPlanSelectionDto)
  plan?: OnboardingPlanSelectionDto;
}

export class GenerateWorkspaceOnboardingDto {
  @ValidateNested()
  @Type(() => OnboardingRoleContextDto)
  role!: OnboardingRoleContextDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => OnboardingTasksContextDto)
  tasks?: OnboardingTasksContextDto;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  lang?: string;
}

export class UpdateWorkspaceOnboardingDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  currentStep?: number;

  @IsOptional()
  @IsString()
  @IsIn(['in_progress', 'completed'])
  status?: 'in_progress' | 'completed';

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => WorkspaceOnboardingStepDataDto)
  stepData?: WorkspaceOnboardingStepDataDto;
}

export class CompleteWorkspaceOnboardingDto {
  @IsOptional()
  @IsString()
  @MaxLength(10)
  lang?: string;
}
