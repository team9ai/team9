import { IsArray, IsUUID, ArrayMinSize } from 'class-validator';

export class MarkNotificationsDto {
  @IsArray()
  @IsUUID('all', { each: true })
  @ArrayMinSize(1)
  notificationIds: string[];
}
