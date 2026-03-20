import { IsNotEmpty, IsOptional, IsString, IsUUID, IsEnum } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { NotificationType, NotificationPriority } from '../notification.entity.js';

export class CreateNotificationDto {
  @ApiProperty() @IsUUID() @IsNotEmpty() userId: string;
  @ApiProperty() @IsString() @IsNotEmpty() title: string;
  @ApiProperty() @IsString() @IsNotEmpty() message: string;
  @ApiPropertyOptional({ enum: NotificationType })
  @IsEnum(NotificationType) @IsOptional() type?: NotificationType;
  @ApiPropertyOptional({ enum: NotificationPriority })
  @IsEnum(NotificationPriority) @IsOptional() priority?: NotificationPriority;
  @ApiPropertyOptional() @IsString() @IsOptional() entityType?: string;
  @ApiPropertyOptional() @IsUUID() @IsOptional() entityId?: string;
}
