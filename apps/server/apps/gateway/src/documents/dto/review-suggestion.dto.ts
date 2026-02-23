import { IsEnum } from 'class-validator';

export class ReviewSuggestionDto {
  @IsEnum(['approve', 'reject'])
  action: 'approve' | 'reject';
}
