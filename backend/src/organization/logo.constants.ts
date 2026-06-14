/**
 * Company logo uploads — images only. SVG is allowed so vector logos stay crisp
 * at any size; it is streamed back behind auth with `nosniff`, and browsers do
 * not execute scripts in SVGs loaded via an <img> tag, so this is safe.
 *
 * Logos live in object storage like every other blob (never in Postgres / on
 * disk); the org row only keeps the `settings.logoKey` pointer.
 */
export const LOGO_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'];
export const LOGO_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.svg'];
export const LOGO_MAX_BYTES = 5 * 1024 * 1024;

/** Response content type for a stored logo key. */
export function logoContentType(key: string): string {
  const l = key.toLowerCase();
  if (l.endsWith('.png')) return 'image/png';
  if (l.endsWith('.webp')) return 'image/webp';
  if (l.endsWith('.svg')) return 'image/svg+xml';
  return 'image/jpeg';
}

/** Resolve a normalized, lowercase extension for an uploaded logo (from name, falling back to mime). */
export function logoExtension(file: { originalname?: string; mimetype?: string }): string {
  const name = (file.originalname || '').toLowerCase();
  const dot = name.lastIndexOf('.');
  const ext = dot >= 0 ? name.slice(dot) : '';
  if (LOGO_EXTENSIONS.includes(ext)) return ext === '.jpeg' ? '.jpg' : ext;
  const mime = (file.mimetype || '').toLowerCase();
  if (mime === 'image/png') return '.png';
  if (mime === 'image/webp') return '.webp';
  if (mime === 'image/svg+xml') return '.svg';
  return '.jpg';
}

/** True when an uploaded file is an acceptable logo image (by mime type). */
export function isLogoMimeType(mimetype?: string): boolean {
  return LOGO_MIME_TYPES.includes((mimetype || '').toLowerCase());
}
