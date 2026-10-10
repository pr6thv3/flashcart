import { Response, NextFunction } from 'express';
import crypto from 'crypto';
import { query } from '../db/pool.js';
import { UnauthorizedError } from '../common/errors.js';
import { AuthenticatedRequest, UserRole } from '../common/types.js';

export async function authenticate(
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    let rawToken: string | undefined;

    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      rawToken = authHeader.substring(7).trim();
    } else if (req.cookies && req.cookies.flashcart_session) {
      rawToken = req.cookies.flashcart_session;
    }

    if (!rawToken) {
      return next();
    }

    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

    const res = await query<{
      session_id: string;
      user_id: string;
      expires_at: Date;
      revoked_at: Date | null;
      email: string;
      full_name: string;
      is_active: boolean;
      roles: string[];
    }>(
      `SELECT s.id AS session_id, s.user_id, s.expires_at, s.revoked_at,
              u.email, u.full_name, u.is_active,
              COALESCE(ARRAY_AGG(r.name) FILTER (WHERE r.name IS NOT NULL), '{}') AS roles
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       LEFT JOIN user_roles ur ON ur.user_id = u.id
       LEFT JOIN roles r ON r.id = ur.role_id
       WHERE s.token_hash = $1
       GROUP BY s.id, s.user_id, s.expires_at, s.revoked_at, u.email, u.full_name, u.is_active`,
      [tokenHash]
    );

    if (res.rows.length === 0) {
      return next();
    }

    const row = res.rows[0];

    // Check if revoked or inactive
    if (row.revoked_at !== null || !row.is_active) {
      return next();
    }

    // Check if expired
    if (new Date(row.expires_at).getTime() <= Date.now()) {
      return next();
    }

    req.sessionId = row.session_id;
    req.user = {
      id: row.user_id,
      email: row.email,
      fullName: row.full_name,
      roles: (row.roles || []) as UserRole[],
    };

    next();
  } catch (err) {
    next(err);
  }
}

export function requireAuth(
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction
): void {
  if (!req.user) {
    throw new UnauthorizedError('Authentication token or session required');
  }
  next();
}
