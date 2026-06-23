/**
 * Convert seconds to a human-readable duration string.
 * e.g. 3661 → "1h 1m 1s"
 */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || seconds < 0) return '0s';

  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);

  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

/**
 * Format elapsed seconds for the live timer display: MM:SS under an hour,
 * H:MM:SS once it passes an hour (so a long shift doesn't read "183:45").
 */
export function formatTimer(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);
  const mm = m.toString().padStart(2, '0');
  const ss = s.toString().padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/**
 * Compact duration for summaries/totals: "3h 20m", "45m", or "0m" (no seconds).
 */
export function formatHm(seconds: number | null | undefined): string {
  const total = seconds && seconds > 0 ? Math.floor(seconds) : 0;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  return `${m}m`;
}

/** Clock time like "2:05 PM" for entry rows. */
export function formatClock(dateString: string | null): string {
  if (!dateString) return '—';
  return new Date(dateString).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/**
 * Format a date string to a locale-friendly display.
 */
export function formatDate(dateString: string | null): string {
  if (!dateString) return '—';
  const d = new Date(dateString);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

/**
 * Format a date string to show just the date for grouping.
 */
export function formatDateGroup(dateString: string): string {
  const d = new Date(dateString);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);

  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}
