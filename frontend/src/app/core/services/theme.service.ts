import { Injectable, signal, effect } from '@angular/core';

export type Theme = 'light' | 'dark';
export type FontSize = 'small' | 'medium' | 'large' | 'x-large';

export const FONT_SIZE_OPTIONS: { value: FontSize; label: string; scale: number }[] = [
  { value: 'small', label: 'Small', scale: 0.9 },
  { value: 'medium', label: 'Medium', scale: 1 },
  { value: 'large', label: 'Large', scale: 1.15 },
  { value: 'x-large', label: 'Extra Large', scale: 1.3 },
];

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly STORAGE_KEY = 'pcs-theme';
  private readonly FONT_SIZE_KEY = 'pcs-font-size';

  theme = signal<Theme>(this.getStoredTheme());
  fontSize = signal<FontSize>(this.getStoredFontSize());

  constructor() {
    effect(() => {
      const t = this.theme();
      document.documentElement.setAttribute('data-theme', t);
      localStorage.setItem(this.STORAGE_KEY, t);
    });
    effect(() => {
      const fs = this.fontSize();
      document.documentElement.setAttribute('data-font-size', fs);
      localStorage.setItem(this.FONT_SIZE_KEY, fs);
    });
  }

  toggle(): void {
    this.theme.update(t => t === 'light' ? 'dark' : 'light');
  }

  setFontSize(size: FontSize): void {
    this.fontSize.set(size);
  }

  private getStoredTheme(): Theme {
    const stored = localStorage.getItem(this.STORAGE_KEY) as Theme | null;
    if (stored === 'light' || stored === 'dark') return stored;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  private getStoredFontSize(): FontSize {
    const stored = localStorage.getItem(this.FONT_SIZE_KEY) as FontSize | null;
    if (stored && ['small', 'medium', 'large', 'x-large'].includes(stored)) return stored;
    return 'medium';
  }
}
