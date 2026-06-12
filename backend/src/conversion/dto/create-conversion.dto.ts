/**
 * Fields accepted alongside the uploaded file on POST /api/conversion/convert.
 * Multipart form values arrive as strings, so booleans/numbers are parsed
 * defensively in the controller rather than relying on transform pipes.
 */
export class CreateConversionDto {
  /** Display name for the resulting 3D model. */
  name: string;

  description?: string;

  /** 'assembly' (default) | 'quality'. */
  modelType?: 'assembly' | 'quality';

  /** Run the AR optimization pass (default true). */
  optimize?: boolean;

  /** Target triangle ratio for decimation: 0 < r <= 1 (1 = no decimation). */
  simplifyRatio?: number;

  /** Apply Draco geometry compression (web-portal variant; default false). */
  draco?: boolean;

  /** Apply KHR_mesh_quantization (default false). */
  quantize?: boolean;

  /** Source length unit for AR scaling: 'mm' | 'cm' | 'm' | 'in' | 'ft'. */
  sourceUnit?: string;

  /** Source up-axis: 'Z' (CAD/IFC) or 'Y' (glTF). Output is converted to Y-up. */
  upAxis?: 'Y' | 'Z';
}
