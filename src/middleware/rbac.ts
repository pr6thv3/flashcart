import { Response, NextFunction } from 'express';
import { ForbiddenError, UnauthorizedError } from '../common/errors.js';
import { AuthenticatedRequest, UserRole } from '../common/types.js';

export function requireRole(...allowedRoles: UserRole[]) {
  return (req: AuthenticatedRequest, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      throw new UnauthorizedError('Authentication required');
    }

    const hasRole = req.user.roles.some((role) => allowedRoles.includes(role));
    if (!hasRole) {
      throw new ForbiddenError(
        `Access denied. Requires one of the following roles: ${allowedRoles.join(', ')}`
      );
    }

    next();
  };
}
