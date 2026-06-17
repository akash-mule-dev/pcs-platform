import { IsBoolean, IsIn, IsInt, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TICKET_CATEGORIES, TICKET_PRIORITIES, TICKET_STATUSES } from '../support-workflow.js';

export class CreateTicketDto {
  @ApiProperty() @IsString() @MinLength(3) @MaxLength(200) subject: string;
  @ApiProperty() @IsString() @MinLength(5) @MaxLength(10000) description: string;
  @ApiPropertyOptional({ enum: TICKET_CATEGORIES }) @IsOptional() @IsIn(TICKET_CATEGORIES as unknown as string[]) category?: string;
  @ApiPropertyOptional({ enum: TICKET_PRIORITIES }) @IsOptional() @IsIn(TICKET_PRIORITIES as unknown as string[]) priority?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) contextUrl?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(50) appVersion?: string;
}

export class ReplyDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(10000) body: string;
  /** Support-only: mark this message as an internal note (hidden from the customer). */
  @ApiPropertyOptional() @IsOptional() @IsBoolean() internal?: boolean;
}

/** Platform desk: update a ticket's triage fields. */
export class UpdateTicketDto {
  @ApiPropertyOptional({ enum: TICKET_STATUSES }) @IsOptional() @IsIn(TICKET_STATUSES as unknown as string[]) status?: string;
  @ApiPropertyOptional({ enum: TICKET_PRIORITIES }) @IsOptional() @IsIn(TICKET_PRIORITIES as unknown as string[]) priority?: string;
  /** Assignee user id, or 'me' to self-assign, or null to unassign. */
  @ApiPropertyOptional() @IsOptional() @IsString() assignedToUserId?: string | null;
  /** Optimistic concurrency guard: the version this edit was based on (409 on mismatch). */
  @ApiPropertyOptional({ description: 'Version this edit was based on; 409 on mismatch' })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) expectedVersion?: number;
}
