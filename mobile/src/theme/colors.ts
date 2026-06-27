export const Colors = {
  // FabriXR Holo — hologram-blue primary + electric-teal secondary
  primary: '#3d5aff',
  primaryDark: '#2538c2',
  secondary: '#14c6b8',
  tertiary: '#6c8cff',
  success: '#2e7d32',
  warning: '#f9a825',
  danger: '#c62828',
  medium: '#757575',
  light: '#f5f5f5',
  white: '#ffffff',
  black: '#000000',
  background: '#f5f5f5',
  card: '#ffffff',
  text: '#212121',
  textSecondary: '#757575',
  border: '#e0e0e0',
  overlay: 'rgba(0, 0, 0, 0.5)',
};

export const StatusColors: Record<string, string> = {
  draft: Colors.medium,
  pending: Colors.warning,
  in_progress: Colors.primary,
  completed: Colors.success,
  cancelled: Colors.danger,
  skipped: Colors.medium,
  low: Colors.success,
  medium: Colors.warning,
  high: Colors.tertiary,
  urgent: Colors.danger,
};

export const PriorityColors: Record<string, string> = {
  low: Colors.success,
  medium: Colors.warning,
  high: Colors.tertiary,
  urgent: Colors.danger,
};
