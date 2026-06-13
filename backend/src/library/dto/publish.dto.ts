import { IsBoolean, IsOptional, IsUUID, ValidateIf } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/** Publish a library item to one tenant (organizationId) or every tenant (allTenants). */
export class PublishDto {
  @ApiPropertyOptional({ description: 'Target tenant organization id' })
  @ValidateIf((o) => !o.allTenants)
  @IsUUID()
  organizationId?: string;

  @ApiPropertyOptional({ description: 'Publish to every active tenant' })
  @IsOptional()
  @IsBoolean()
  allTenants?: boolean;
}
