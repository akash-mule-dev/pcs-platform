import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { canView } from '../permissions';

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

/** Guard by feature name — reads allowed roles from the central permissions config */
export const featureGuard = (feature: string): CanActivateFn => {
  return () => {
    const auth = inject(AuthService);
    const router = inject(Router);
    if (canView(feature, auth.userRole)) return true;
    router.navigate(['/']);
    return false;
  };
};
