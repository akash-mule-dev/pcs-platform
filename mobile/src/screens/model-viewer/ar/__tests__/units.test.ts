import { formatLength } from '../format-length';

describe('formatLength — metric', () => {
  it('formats metres / cm / mm by magnitude', () => {
    expect(formatLength(1.5, 'metric')).toBe('1.50 m');
    expect(formatLength(0.05, 'metric')).toBe('5.0 cm');
    expect(formatLength(0.003, 'metric')).toBe('3 mm');
  });
  it('defaults to metric', () => {
    expect(formatLength(1.5)).toBe('1.50 m');
  });
});

describe('formatLength — imperial (steel feet-inches, 1/16")', () => {
  it('feet + whole inches', () => {
    expect(formatLength(1.6, 'imperial')).toBe("5' 3\""); // 62.99" → 5'3"
  });
  it('inches only when under a foot', () => {
    expect(formatLength(0.0254, 'imperial')).toBe('1"');
  });
  it('fraction only when under an inch', () => {
    expect(formatLength(0.0127, 'imperial')).toBe('1/2"'); // 0.5"
  });
  it('inch + fraction', () => {
    // 3.5" = 0.0889 m → 3-1/2"
    expect(formatLength(0.0889, 'imperial')).toBe('3-1/2"');
  });
  it('feet + inch + fraction', () => {
    // 2' 6-1/4" = 30.25" = 0.76835 m
    expect(formatLength(0.76835, 'imperial')).toBe("2' 6-1/4\"");
  });
  it('zero', () => {
    expect(formatLength(0, 'imperial')).toBe('0"');
  });
});
