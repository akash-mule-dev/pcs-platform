import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, MaxLength } from 'class-validator';

/** Body for PATCH /api/auth/tours — mark a guided tour as seen at a version. */
export class MarkTourDto {
  @ApiProperty({ example: 'onboarding', description: 'Registered tour id' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  tourId: string;

  @ApiProperty({ example: 'v1', description: 'Tour version the user saw' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  version: string;
}
