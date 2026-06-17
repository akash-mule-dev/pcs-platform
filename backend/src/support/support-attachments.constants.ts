/**
 * Support-ticket attachments — images (a screenshot of the bug) or a PDF
 * (a report / invoice). Shared by the customer and platform-desk upload paths.
 */
export const SUPPORT_ATTACH_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
export const SUPPORT_ATTACH_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.pdf'];
export const SUPPORT_ATTACH_MAX_BYTES = 10 * 1024 * 1024;

/** Response content type for a stored attachment key. */
export function supportAttachmentContentType(key: string): string {
  const lower = key.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.pdf')) return 'application/pdf';
  return 'image/jpeg';
}
