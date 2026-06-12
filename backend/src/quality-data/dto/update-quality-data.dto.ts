import { OmitType, PartialType } from '@nestjs/swagger';
import { CreateQualityDataDto } from './create-quality-data.dto.js';

/**
 * Editable fields of an inspection entry. What the record is ABOUT
 * (model / assembly node / project) is immutable after creation — re-linking
 * a finding to a different part would falsify the trail.
 */
export class UpdateQualityDataDto extends PartialType(
  OmitType(CreateQualityDataDto, ['modelId', 'assemblyNodeId', 'projectId'] as const),
) {}
