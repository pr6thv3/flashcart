import { Response, NextFunction } from 'express';
import { query } from '../db/pool.js';
import { ForbiddenError, UnauthorizedError } from '../common/errors.js';
import { AuthenticatedRequest, VendorProfileContext } from '../common/types.js';

export async function requireVendor(
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) {
      throw new UnauthorizedError('Authentication required');
    }

    const res = await query<VendorProfileContext>(
      `SELECT id, user_id as "userId", store_name as "storeName", slug, status
       FROM vendor_profiles
       WHERE user_id = $1`,
      [req.user.id]
    );

    if (res.rows.length === 0) {
      throw new ForbiddenError('Vendor profile not found for authenticated user');
    }

    const profile = res.rows[0];
    if (profile.status !== 'approved') {
      throw new ForbiddenError(
        `Vendor profile is currently ${profile.status}. Approved vendor profile required.`
      );
    }

    req.vendorId = profile.id;
    req.vendor = profile;
    next();
  } catch (err) {
    next(err);
  }
}
