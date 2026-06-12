import { Colors } from './colors';

/**
 * Work-order screens design tokens — FabStation-inspired: deep teal-navy
 * bands with white content cards, quiet grays, strong status colors.
 */
export const WO = {
  ink: '#0d2f40', // deep teal-navy: header bands, selected stage
  inkDark: '#092230',
  inkLine: 'rgba(255,255,255,0.16)',
  onInk: '#ffffff',
  onInkSoft: 'rgba(255,255,255,0.72)',
  onInkFaint: 'rgba(255,255,255,0.45)',
  mist: '#f1f5f8', // page wash
  card: '#ffffff',
  line: '#dfe7ed',
  text: '#15242e',
  textSoft: '#5b6b76',
  accent: Colors.primary,
  good: '#2e7d32',
  goodBg: '#e7f2e8',
  warn: '#b45309',
  warnBg: '#fdf3e0',
  bad: '#c62828',
  badBg: '#fdecea',
  info: '#1565c0',
  infoBg: '#e8f0fe',
  muteBg: '#eef1f4',
};

export type ShipStatusM = 'in_production' | 'blocked_ncr' | 'ready' | 'allocated' | 'shipped';

export const SHIP_META: Record<ShipStatusM, { label: string; short: string; icon: string; fg: string; bg: string }> = {
  ready: { label: 'Ready to ship', short: 'Ready', icon: 'cube', fg: WO.good, bg: WO.goodBg },
  shipped: { label: 'Shipped', short: 'Shipped', icon: 'checkmark-done', fg: WO.textSoft, bg: WO.muteBg },
  allocated: { label: 'On a load', short: 'Loaded', icon: 'time', fg: WO.info, bg: WO.infoBg },
  blocked_ncr: { label: 'Ship blocked — NCR', short: 'NCR', icon: 'alert-circle', fg: WO.bad, bg: WO.badBg },
  in_production: { label: 'In production', short: 'In prod', icon: 'construct', fg: WO.textSoft, bg: WO.muteBg },
};

export const STAGE_COLORS: Record<string, string> = {
  pending: '#9aa7b0',
  in_progress: '#f9a825',
  completed: WO.good,
  skipped: '#9aa7b0',
};
export const STAGE_LABELS: Record<string, string> = {
  pending: 'Not started',
  in_progress: 'In progress',
  completed: 'Completed',
  skipped: 'Skipped',
};
