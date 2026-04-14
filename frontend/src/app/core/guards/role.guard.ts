import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { PermissionsService } from '../services/permissions.service';

/** Guard by explicit role list */
export const roleGuard = (...allowedRoles: string[]): CanActivateFn => {
  return () => {
    const auth = inject(AuthService);
    const router = inject(Router);
    if (auth.hasRole(...allowedRoles)) return true;
    router.navigate(['/']);
    return false;
  };
};

/** Guard by feature name — reads allowed roles from the backend permissions config */
export const featureGuard = (feature: string): CanActivateFn => {
  return () => {
    const permissions = inject(PermissionsService);
    const router = inject(Router);
    if (permissions.canView(feature)) return true;
    router.navigate(['/']);
    return false;
  };
};
