import { IsString, IsNotEmpty, IsOptional, IsIn, IsNumber } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Record a quality check on an assembly node (model/mesh/node/project filled server-side). */
export class RecordNodeQualityDto {
  @ApiProperty({ enum: ['pass', 'fail', 'warning'] })
  @IsString() @IsNotEmpty() @IsIn(['pass', 'fail', 'warning']) status: string;
  @ApiPropertyOptional() @IsOptional() @IsString() inspector?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() defectType?: string;
  @ApiPropertyOptional({ enum: ['low', 'medium', 'high', 'critical'] })
  @IsOptional() @IsString() @IsIn(['low', 'medium', 'high', 'critical']) severity?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() measurementValue?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() measurementUnit?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() toleranceMin?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() toleranceMax?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() regionLabel?: string;
}
