import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Sign-off decision payload. The decider's identity is stamped from the
 * authenticated user server-side — any client-sent name is ignored.
 */
export class SignoffQualityDataDto {
  @ApiProperty({ enum: ['approved', 'rejected'] })
  @IsString() @IsIn(['approved', 'rejected'])
  status: 'approved' | 'rejected';

  @ApiPropertyOptional()
  @IsOptional() @IsString() @MaxLength(2000)
  notes?: string;
}
