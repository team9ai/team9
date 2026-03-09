import { IsIn } from 'class-validator';

export class ReviewVersionDto {
  @IsIn(['approve', 'reject'] as const)
  action: 'approve' | 'reject';
}
