import { Injectable, inject } from '@angular/core';
import { MatSnackBar, MatSnackBarConfig } from '@angular/material/snack-bar';

/**
 * Thin, app-wide wrapper over MatSnackBar for ACTION feedback — the answer to
 * "did that actually work?". Use `success()` after a mutation completes, `error()`
 * for a handled failure (the HTTP error interceptor already covers unhandled 4xx/5xx),
 * and `info()` for neutral notices. Panel classes (`success-snackbar` / `error-snackbar`
 * / `info-snackbar`) are themed in styles.scss for light + dark.
 */
@Injectable({ providedIn: 'root' })
export class ToastService {
  private snack = inject(MatSnackBar);

  private config(panelClass: string, duration: number): MatSnackBarConfig {
    return { duration, horizontalPosition: 'center', verticalPosition: 'bottom', panelClass: [panelClass] };
  }

  /** A mutation succeeded (saved / issued / resolved / shipped …). */
  success(message: string, action = 'OK'): void {
    this.snack.open(message, action, this.config('success-snackbar', 3500));
  }

  /** A handled failure the caller wants to surface explicitly. */
  error(message: string, action = 'Dismiss'): void {
    this.snack.open(message, action, this.config('error-snackbar', 6000));
  }

  /** A neutral, non-blocking notice. */
  info(message: string, action = 'OK'): void {
    this.snack.open(message, action, this.config('info-snackbar', 3500));
  }
}
