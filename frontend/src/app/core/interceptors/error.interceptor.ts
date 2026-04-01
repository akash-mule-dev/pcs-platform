import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';
import { catchError, throwError } from 'rxjs';

export const errorInterceptor: HttpInterceptorFn = (req, next) => {
  const router = inject(Router);
  const snackBar = inject(MatSnackBar);

  return next(req).pipe(
    catchError(error => {
      if (error.status === 401 && !req.url.includes('/auth/login')) {
        localStorage.removeItem('pcs_token');
        localStorage.removeItem('pcs_user');
        router.navigate(['/login']);
        snackBar.open('Session expired. Please login again.', 'Close', { duration: 5000 });
      } else if (error.status === 404) {
        // Suppress snackbar for 404s - let components handle "not found" gracefully
      } else if (error.status >= 400) {
        const message = error.error?.message || error.message || 'An error occurred';
        snackBar.open(message, 'Close', { duration: 5000, panelClass: 'error-snackbar' });
      }
      return throwError(() => error);
    })
  );
};
