import { IsNotEmpty, IsOptional, IsString, IsUUID, IsIn, IsNumber, IsDateString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateQualityDataDto {
  @ApiProperty() @IsUUID() @IsNotEmpty() modelId: string;
  @ApiProperty() @IsString() @IsNotEmpty() meshName: string;
  @ApiPropertyOptional() @IsString() @IsOptional() regionLabel?: string;
  @ApiProperty({ enum: ['pass', 'fail', 'warning'] })
  @IsString() @IsNotEmpty() @IsIn(['pass', 'fail', 'warning']) status: string;
  @ApiPropertyOptional() @IsString() @IsOptional() inspector?: string;
  @ApiPropertyOptional() @IsDateString() @IsOptional() inspectionDate?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() notes?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() defectType?: string;
  @ApiPropertyOptional({ enum: ['low', 'medium', 'high', 'critical'] })
  @IsString() @IsOptional() @IsIn(['low', 'medium', 'high', 'critical']) severity?: string;
  @ApiPropertyOptional() @IsNumber() @IsOptional() measurementValue?: number;
  @ApiPropertyOptional() @IsString() @IsOptional() measurementUnit?: string;
  @ApiPropertyOptional() @IsNumber() @IsOptional() toleranceMin?: number;
  @ApiPropertyOptional() @IsNumber() @IsOptional() toleranceMax?: number;
}
