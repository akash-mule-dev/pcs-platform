/** Evidence uploads must be images — shared by quality-data and NCR endpoints. */
export const EVIDENCE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
export const EVIDENCE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'];
export const EVIDENCE_MAX_BYTES = 10 * 1024 * 1024;

/** Response content type for a stored evidence key. */
export function evidenceContentType(key: string): string {
  const lower = key.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  return 'image/jpeg';
}
