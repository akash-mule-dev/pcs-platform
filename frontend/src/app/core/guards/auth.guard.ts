import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { PermissionsService } from '../services/permissions.service';

export const authGuard: CanActivateFn = async () => {
  const router = inject(Router);
  const permissions = inject(PermissionsService);
  const token = localStorage.getItem('pcs_token');
  if (!token) {
    router.navigate(['/login']);
    return false;
  }
  if (!permissions.isLoaded) {
    await permissions.load();
  }
  return true;
};
